import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { withTransaction } from '../../infra/db/transaction';
import { MembershipService } from '../household/membership.service';
import { DomainError } from '../inventory/domain/errors';

/**
 * 数据导出与删除（docs/01 §11、docs/02 §15.3）。
 * 用户对自己家庭的数据拥有导出和删除权（隐私合规）。
 * 删除仅家庭 Owner 可发起，物理删除该家庭全部数据（级联）。
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly membership: MembershipService,
  ) {}

  /** 导出家庭全部数据为结构化 JSON（成员、库存、交易、语音任务元数据）。 */
  async exportHousehold(householdId: string, userId: string) {
    await this.membership.assertMembership(householdId, userId);

    const [household, members, lots, transactions, voiceJobs] = await Promise.all([
      this.pool.query(`select id, name, timezone, created_at from households where id = $1`, [
        householdId,
      ]),
      this.pool.query(
        `select id, display_name, role, user_id is not null as has_account, created_at
         from household_members where household_id = $1`,
        [householdId],
      ),
      this.pool.query(
        `select l.id, fc.canonical_name as food, l.remaining_quantity, l.initial_quantity,
                l.unit_code, l.purchased_at, l.expires_at, l.expiry_source, l.status
         from inventory_lots l join food_catalog fc on fc.id = l.food_id
         where l.household_id = $1 order by l.created_at`,
        [householdId],
      ),
      this.pool.query(
        `select id, transaction_type, source_channel, idempotency_key, metadata_json, created_at
         from inventory_transactions where household_id = $1 order by created_at`,
        [householdId],
      ),
      // 语音任务导出转录文本元数据；原始音频从不落库
      this.pool.query(
        `select id, status, transcript_raw, transcript_normalized, error_code, created_at
         from voice_jobs where household_id = $1 order by created_at`,
        [householdId],
      ),
    ]);

    return {
      exported_at: new Date().toISOString(),
      household: household.rows[0] ?? null,
      members: members.rows,
      inventory_lots: lots.rows,
      transactions: transactions.rows,
      voice_jobs: voiceJobs.rows,
      notice: '本导出不含原始音频（原始音频从不持久化存储）。',
    };
  }

  /**
   * 删除家庭全部数据。仅 Owner 可发起。
   * 依赖外键 on delete cascade 级联删除库存、交易、语音任务、outbox 等。
   */
  async deleteHousehold(householdId: string, userId: string): Promise<{ deleted: true }> {
    const membership = await this.membership.assertMembership(householdId, userId);
    if (membership.role !== 'OWNER') {
      throw new DomainError(
        'AUTHORIZATION',
        'OWNER_ROLE_REQUIRED',
        'Only the household owner can delete household data.',
      );
    }
    await withTransaction(this.pool, async (client) => {
      await client.query(`delete from households where id = $1`, [householdId]);
    });
    return { deleted: true };
  }
}
