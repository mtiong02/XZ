import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import { withTransaction } from '../../infra/db/transaction';
import { DomainError } from '../inventory/domain/errors';
import { MembershipService } from './membership.service';

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64).default('Asia/Kuala_Lumpur'),
  owner_display_name: z.string().min(1).max(50),
});
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdSchema>;

export const AddMemberSchema = z.object({
  display_name: z.string().min(1).max(50),
});

export const JoinHouseholdSchema = z.object({
  invite_code: z.string().trim().min(6).max(32),
  display_name: z.string().trim().min(1).max(50),
});

export interface HouseholdView {
  id: string;
  name: string;
  timezone: string;
  role: 'OWNER' | 'MEMBER';
  member_id: string;
  refrigerator_id: string;
}

const DEFAULT_ZONES = [
  { code: 'FRIDGE', name: '保鲜室', position: 0 },
  { code: 'FREEZER', name: '冷冻室', position: 1 },
  { code: 'PANTRY', name: '常温区', position: 2 },
] as const;

@Injectable()
export class HouseholdService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly membership: MembershipService,
  ) {}

  /** 创建家庭 + Owner 成员 + 默认冰箱与三个分区（FR-002、FR-004），单事务。 */
  async createHousehold(userId: string, input: CreateHouseholdInput): Promise<HouseholdView> {
    return withTransaction(this.pool, async (client) => {
      const household = (
        await client.query<{ id: string }>(
          `insert into households (name, timezone, created_by_user_id)
           values ($1, $2, $3) returning id`,
          [input.name, input.timezone, userId],
        )
      ).rows[0];
      if (!household) throw new Error('household insert returned no row');

      const member = (
        await client.query<{ id: string }>(
          `insert into household_members (household_id, user_id, display_name, role)
           values ($1, $2, $3, 'OWNER') returning id`,
          [household.id, userId, input.owner_display_name],
        )
      ).rows[0];
      if (!member) throw new Error('member insert returned no row');

      const fridge = (
        await client.query<{ id: string }>(
          `insert into refrigerators (household_id, name) values ($1, '默认冰箱') returning id`,
          [household.id],
        )
      ).rows[0];
      if (!fridge) throw new Error('refrigerator insert returned no row');

      for (const zone of DEFAULT_ZONES) {
        await client.query(
          `insert into storage_zones (refrigerator_id, household_id, code, name, position)
           values ($1, $2, $3, $4, $5)`,
          [fridge.id, household.id, zone.code, zone.name, zone.position],
        );
      }

      await client.query(
        `insert into inventory_revisions (household_id, revision) values ($1, 0)`,
        [household.id],
      );

      return {
        id: household.id,
        name: input.name,
        timezone: input.timezone,
        role: 'OWNER' as const,
        member_id: member.id,
        refrigerator_id: fridge.id,
      };
    });
  }

  async listMyHouseholds(userId: string): Promise<HouseholdView[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      timezone: string;
      role: 'OWNER' | 'MEMBER';
      member_id: string;
      refrigerator_id: string;
    }>(
      `select h.id, h.name, h.timezone, hm.role, hm.id as member_id, r.id as refrigerator_id
       from households h
       join household_members hm on hm.household_id = h.id and hm.user_id = $1
       join refrigerators r on r.household_id = h.id
       order by h.created_at`,
      [userId],
    );
    return result.rows;
  }

  async listMembers(householdId: string, userId: string) {
    await this.membership.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `select id, display_name, role, user_id is not null as has_account, created_at
       from household_members where household_id = $1 order by created_at`,
      [householdId],
    );
    return result.rows;
  }

  /** 添加无账号成员（FR-003）。仅 OWNER 可添加。 */
  async addMember(householdId: string, userId: string, displayName: string) {
    const membership = await this.membership.assertMembership(householdId, userId);
    if (membership.role !== 'OWNER') {
      throw new DomainError('AUTHORIZATION', 'OWNER_ROLE_REQUIRED', 'Only owner can add members.');
    }
    const result = await this.pool.query<{ id: string }>(
      `insert into household_members (household_id, display_name, role)
       values ($1, $2, 'MEMBER') returning id`,
      [householdId, displayName],
    );
    return { id: result.rows[0]?.id, display_name: displayName, role: 'MEMBER' };
  }

  /** 创建限时家庭邀请码。邀请码只在生成响应中返回，数据库仅保存摘要。 */
  async createInvite(householdId: string, userId: string) {
    const member = await this.membership.assertMembership(householdId, userId);
    if (member.role !== 'OWNER') {
      throw new DomainError('AUTHORIZATION', 'OWNER_ROLE_REQUIRED', 'Only owner can create invites.');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `XZ-${randomBytes(4).toString('hex').toUpperCase()}`;
      const codeHash = createHash('sha256').update(code).digest('hex');
      try {
        const result = await this.pool.query<{ expires_at: string }>(
          `insert into household_invites
             (household_id, code_hash, created_by_member_id, expires_at)
           values ($1, $2, $3, now() + interval '7 days')
           returning expires_at`,
          [householdId, codeHash, member.memberId],
        );
        return { code, expires_at: result.rows[0]?.expires_at };
      } catch (error) {
        // A vanishingly rare hash collision can safely be retried.
        if ((error as { code?: string }).code !== '23505' || attempt === 4) throw error;
      }
    }
    throw new Error('Unable to create household invite.');
  }

  /** 通过邀请码把当前登录账号加入家庭；同一账号重复加入时幂等返回已有家庭。 */
  async joinHousehold(userId: string, inviteCode: string, displayName: string): Promise<HouseholdView> {
    const normalizedCode = inviteCode.trim().toUpperCase();
    const codeHash = createHash('sha256').update(normalizedCode).digest('hex');

    return withTransaction(this.pool, async (client) => {
      const invite = (
        await client.query<{
          id: string;
          household_id: string;
          expires_at: string;
          max_uses: number;
          used_count: number;
        }>(
          `select id, household_id, expires_at, max_uses, used_count
             from household_invites
            where code_hash = $1 and revoked_at is null
            for update`,
          [codeHash],
        )
      ).rows[0];
      if (!invite || new Date(invite.expires_at).getTime() <= Date.now() || invite.used_count >= invite.max_uses) {
        throw new DomainError('VALIDATION', 'HOUSEHOLD_INVITE_INVALID', '邀请码无效或已过期。');
      }

      const existing = (
        await client.query<{ id: string; display_name: string; role: 'OWNER' | 'MEMBER' }>(
          `select id, display_name, role from household_members
            where household_id = $1 and user_id = $2`,
          [invite.household_id, userId],
        )
      ).rows[0];
      let member = existing;
      if (!member) {
        const placeholder = (
          await client.query<{ id: string; display_name: string; role: 'OWNER' | 'MEMBER' }>(
            `select id, display_name, role from household_members
              where household_id = $1 and user_id is null and lower(display_name) = lower($2)
              order by created_at limit 1 for update`,
            [invite.household_id, displayName],
          )
        ).rows[0];
        member = placeholder
          ? (
              await client.query<{ id: string; display_name: string; role: 'OWNER' | 'MEMBER' }>(
                `update household_members set user_id = $1 where id = $2 returning id, display_name, role`,
                [userId, placeholder.id],
              )
            ).rows[0]
          : (
              await client.query<{ id: string; display_name: string; role: 'OWNER' | 'MEMBER' }>(
                `insert into household_members (household_id, user_id, display_name, role)
                 values ($1, $2, $3, 'MEMBER')
                 returning id, display_name, role`,
                [invite.household_id, userId, displayName],
              )
            ).rows[0];
        await client.query(`update household_invites set used_count = used_count + 1 where id = $1`, [invite.id]);
      }

      const household = (
        await client.query<{ id: string; name: string; timezone: string; refrigerator_id: string }>(
          `select h.id, h.name, h.timezone, r.id as refrigerator_id
             from households h join refrigerators r on r.household_id = h.id
            where h.id = $1`,
          [invite.household_id],
        )
      ).rows[0];
      if (!household || !member) throw new Error('household join returned no row');
      return {
        id: household.id,
        name: household.name,
        timezone: household.timezone,
        role: member.role,
        member_id: member.id,
        refrigerator_id: household.refrigerator_id,
      };
    });
  }
}
