import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { DomainError } from '../inventory/domain/errors';

export interface Membership {
  memberId: string;
  householdId: string;
  role: 'OWNER' | 'MEMBER';
  displayName: string;
}

/**
 * 家庭成员资格校验：多租户隔离的第一道防线（docs/02 §15.1）。
 * 每个需要 household 上下文的请求都必须经过这里。
 */
@Injectable()
export class MembershipService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findMembership(householdId: string, userId: string): Promise<Membership | null> {
    const result = await this.pool.query<{
      id: string;
      household_id: string;
      role: 'OWNER' | 'MEMBER';
      display_name: string;
    }>(
      `select id, household_id, role, display_name
       from household_members
       where household_id = $1 and user_id = $2`,
      [householdId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      memberId: row.id,
      householdId: row.household_id,
      role: row.role,
      displayName: row.display_name,
    };
  }

  async assertMembership(householdId: string, userId: string): Promise<Membership> {
    const membership = await this.findMembership(householdId, userId);
    if (!membership) {
      // 对越权访问统一返回 404 语义之外的 403；不泄漏家庭是否存在
      throw new DomainError('AUTHORIZATION', 'HOUSEHOLD_ACCESS_DENIED', 'Not a household member.');
    }
    return membership;
  }
}
