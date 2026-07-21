import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { InventoryView, InventoryZoneView, TransactionView } from '@xz/contracts';
import { PG_POOL } from '../../../infra/db/database.module';
import { MembershipService } from '../../household/membership.service';
import { computeExpiryStatus } from '../domain/expiry';

@Injectable()
export class InventoryQueryService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly membership: MembershipService,
  ) {}

  /** 数字冰箱首页视图（docs/03 §6.1）：分区 -> 食材聚合。 */
  async getInventoryView(householdId: string, userId: string): Promise<InventoryView> {
    await this.membership.assertMembership(householdId, userId);

    const [revisionResult, zonesResult, itemsResult] = await Promise.all([
      this.pool.query<{ revision: string }>(
        `select revision from inventory_revisions where household_id = $1`,
        [householdId],
      ),
      this.pool.query<{ id: string; code: 'FRIDGE' | 'FREEZER' | 'PANTRY'; name: string }>(
        `select id, code, name from storage_zones
         where household_id = $1 order by position`,
        [householdId],
      ),
      this.pool.query<{
        zone_id: string;
        food_id: string;
        name: string;
        category: string;
        total_quantity: string;
        unit: string;
        earliest_expiry: Date | null;
        lot_count: string;
      }>(
        `select l.storage_zone_id as zone_id, l.food_id, fc.canonical_name as name,
                fc.category, sum(l.remaining_quantity)::text as total_quantity,
                l.unit_code as unit, min(l.expires_at) as earliest_expiry,
                count(*)::text as lot_count
         from inventory_lots l
         join food_catalog fc on fc.id = l.food_id
         where l.household_id = $1 and l.status = 'ACTIVE' and l.remaining_quantity > 0
         group by l.storage_zone_id, l.food_id, fc.canonical_name, fc.category, l.unit_code
         order by min(l.expires_at) asc nulls last`,
        [householdId],
      ),
    ]);

    const now = new Date();
    const zones: InventoryZoneView[] = zonesResult.rows.map((zone) => ({
      zone_id: zone.id,
      code: zone.code,
      name: zone.name,
      items: itemsResult.rows
        .filter((item) => item.zone_id === zone.id)
        .map((item) => ({
          food_id: item.food_id,
          name: item.name,
          category: item.category,
          total_quantity: item.total_quantity,
          unit: item.unit,
          earliest_expiry: item.earliest_expiry?.toISOString() ?? null,
          expiry_status: computeExpiryStatus(item.earliest_expiry, now),
          lot_count: Number(item.lot_count),
        })),
    }));

    return {
      household_id: householdId,
      revision: Number(revisionResult.rows[0]?.revision ?? 0),
      zones,
    };
  }

  /** 临期列表（FR-012）：按到期日排序，含已过期。 */
  async getExpiring(householdId: string, userId: string, withinDays: number) {
    await this.membership.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `select l.id as lot_id, l.food_id, fc.canonical_name as name,
              l.remaining_quantity::text as remaining_quantity, l.unit_code as unit,
              l.expires_at, sz.name as zone_name
       from inventory_lots l
       join food_catalog fc on fc.id = l.food_id
       join storage_zones sz on sz.id = l.storage_zone_id
       where l.household_id = $1 and l.status = 'ACTIVE' and l.remaining_quantity > 0
         and l.expires_at is not null
         and l.expires_at <= now() + make_interval(days => $2)
       order by l.expires_at asc`,
      [householdId, withinDays],
    );
    const now = new Date();
    return result.rows.map((row: { expires_at: Date }) => ({
      ...row,
      expires_at: row.expires_at.toISOString(),
      expiry_status: computeExpiryStatus(row.expires_at, now),
    }));
  }

  /**
   * 本周基础统计（FR-018、docs/04 Sprint 5）：使用量、丢弃量、临期处理率。
   * 全部基于真实交易流水，确定性计算，不含 AI 推断。
   */
  async getWeeklyStats(householdId: string, userId: string) {
    await this.membership.assertMembership(householdId, userId);

    const [txnAgg, activeAgg, handledAgg] = await Promise.all([
      // 近 7 天各类交易的净变化量（按 |delta| 汇总消耗/丢弃）
      this.pool.query<{ transaction_type: string; total: string; count: string }>(
        `select t.transaction_type,
                coalesce(sum(abs(e.quantity_delta)), 0)::text as total,
                count(distinct t.id)::text as count
         from inventory_transactions t
         join inventory_transaction_entries e on e.transaction_id = t.id
         where t.household_id = $1 and t.created_at >= now() - interval '7 days'
         group by t.transaction_type`,
        [householdId],
      ),
      // 当前在库食材数与临期/过期数
      this.pool.query<{ active_items: string; expiring: string; expired: string }>(
        `select
           count(distinct food_id) filter (where remaining_quantity > 0) as active_items,
           count(*) filter (
             where expires_at is not null and expires_at > now()
               and expires_at <= now() + interval '2 days' and remaining_quantity > 0
           ) as expiring,
           count(*) filter (
             where expires_at is not null and expires_at <= now() and remaining_quantity > 0
           ) as expired
         from inventory_lots
         where household_id = $1 and status = 'ACTIVE'`,
        [householdId],
      ),
      // 临期处理率：近 7 天曾临期的批次中，已被使用/丢弃处理掉的比例
      this.pool.query<{ handled: string; total: string }>(
        `with expiring_lots as (
           select distinct l.id
           from inventory_lots l
           where l.household_id = $1
             and l.expires_at is not null
             and l.expires_at >= now() - interval '7 days'
             and l.expires_at <= now() + interval '2 days'
         )
         select
           count(*) filter (
             where exists (
               select 1 from inventory_transaction_entries e
               join inventory_transactions t on t.id = e.transaction_id
               where e.lot_id = el.id and t.transaction_type in ('CONSUME', 'DISCARD')
             )
           )::text as handled,
           count(*)::text as total
         from expiring_lots el`,
        [householdId],
      ),
    ]);

    const byType = new Map(txnAgg.rows.map((row) => [row.transaction_type, row]));
    const consumed = byType.get('CONSUME');
    const discarded = byType.get('DISCARD');
    const added = byType.get('ADD');
    const handled = handledAgg.rows[0];
    const active = activeAgg.rows[0];

    const handledTotal = Number(handled?.total ?? 0);
    const handledRate = handledTotal === 0 ? null : Number(handled?.handled ?? 0) / handledTotal;

    return {
      window_days: 7,
      consumed_quantity: consumed?.total ?? '0',
      consumed_count: Number(consumed?.count ?? 0),
      discarded_quantity: discarded?.total ?? '0',
      discarded_count: Number(discarded?.count ?? 0),
      added_count: Number(added?.count ?? 0),
      active_items: Number(active?.active_items ?? 0),
      expiring_count: Number(active?.expiring ?? 0),
      expired_count: Number(active?.expired ?? 0),
      // 临期处理率：null 表示本周无临期批次，不强行给 0（避免误导）
      expiry_handled_rate: handledRate === null ? null : Number(handledRate.toFixed(2)),
    };
  }

  /** 活动时间线（FR-013）：cursor 分页（docs/07 §8）。 */
  async getTransactions(
    householdId: string,
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: TransactionView[]; next_cursor: string | null }> {
    await this.membership.assertMembership(householdId, userId);

    const cursorCondition = cursor
      ? `and (t.created_at, t.id) < (select created_at, id from inventory_transactions where id = $3)`
      : '';
    const params: unknown[] = [householdId, limit + 1];
    if (cursor) params.push(cursor);

    const result = await this.pool.query<{
      id: string;
      transaction_type: TransactionView['transaction_type'];
      food_id: string | null;
      food_name: string | null;
      quantity_delta: string | null;
      unit: string | null;
      source_channel: string;
      actor_member_id: string;
      actor_display_name: string;
      reversed_transaction_id: string | null;
      reversed_by_transaction_id: string | null;
      created_at: Date;
    }>(
      `select t.id, t.transaction_type, t.food_id,
              coalesce(fc.canonical_name, efc.multi_names) as food_name,
              e.total_delta::text as quantity_delta, e.unit,
              t.source_channel, t.actor_member_id, hm.display_name as actor_display_name,
              t.reversed_transaction_id, r.id as reversed_by_transaction_id, t.created_at
       from inventory_transactions t
       join household_members hm on hm.id = t.actor_member_id
       left join food_catalog fc on fc.id = t.food_id
       left join lateral (
         select sum(quantity_delta) as total_delta, min(unit_code) as unit
         from inventory_transaction_entries where transaction_id = t.id
       ) e on true
       left join lateral (
         select string_agg(distinct fc2.canonical_name, '、') as multi_names
         from inventory_transaction_entries e2
         join inventory_lots l2 on l2.id = e2.lot_id
         join food_catalog fc2 on fc2.id = l2.food_id
         where e2.transaction_id = t.id
       ) efc on t.food_id is null
       left join inventory_transactions r on r.reversed_transaction_id = t.id
       where t.household_id = $1 ${cursorCondition}
       order by t.created_at desc, t.id desc
       limit $2`,
      params,
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    return {
      items: rows.map((row) => ({
        id: row.id,
        transaction_type: row.transaction_type,
        food_id: row.food_id ?? '',
        food_name: row.food_name ?? '多种食材',
        quantity_delta: row.quantity_delta ?? '0',
        unit: row.unit ?? '',
        source_channel: row.source_channel,
        actor_member_id: row.actor_member_id,
        actor_display_name: row.actor_display_name,
        reversed_transaction_id: row.reversed_transaction_id,
        reversed_by_transaction_id: row.reversed_by_transaction_id,
        created_at: row.created_at.toISOString(),
      })),
      next_cursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  /** 食材详情（docs/01 §7.4）：批次 + 该食材最近交易。 */
  async getFoodDetail(householdId: string, userId: string, foodId: string) {
    await this.membership.assertMembership(householdId, userId);
    const now = new Date();

    const [foodResult, lotsResult, txResult] = await Promise.all([
      this.pool.query(
        `select id, canonical_name, category, default_unit_code, default_shelf_life_days
         from food_catalog where id = $1 and (household_id is null or household_id = $2)`,
        [foodId, householdId],
      ),
      this.pool.query<{
        id: string;
        remaining_quantity: string;
        initial_quantity: string;
        unit_code: string;
        purchased_at: Date;
        expires_at: Date | null;
        expiry_source: string;
        status: string;
        zone_name: string;
      }>(
        `select l.id, l.remaining_quantity::text as remaining_quantity,
                l.initial_quantity::text as initial_quantity, l.unit_code,
                l.purchased_at, l.expires_at, l.expiry_source, l.status, sz.name as zone_name
         from inventory_lots l
         join storage_zones sz on sz.id = l.storage_zone_id
         where l.household_id = $1 and l.food_id = $2 and l.status = 'ACTIVE'
           and l.remaining_quantity > 0
         order by l.expires_at asc nulls last`,
        [householdId, foodId],
      ),
      this.pool.query(
        `select t.id, t.transaction_type, e.total_delta::text as quantity_delta,
                t.metadata_json, hm.display_name as actor_display_name, t.created_at,
                r.id is not null as reversed
         from inventory_transactions t
         join household_members hm on hm.id = t.actor_member_id
         left join lateral (
           select sum(quantity_delta) as total_delta
           from inventory_transaction_entries e2
           join inventory_lots l2 on l2.id = e2.lot_id
           where e2.transaction_id = t.id and l2.food_id = $2
         ) e on true
         left join inventory_transactions r on r.reversed_transaction_id = t.id
         where t.household_id = $1
           and (t.food_id = $2 or exists (
             select 1 from inventory_transaction_entries e3
             join inventory_lots l3 on l3.id = e3.lot_id
             where e3.transaction_id = t.id and l3.food_id = $2))
         order by t.created_at desc limit 20`,
        [householdId, foodId],
      ),
    ]);

    const food = foodResult.rows[0];
    if (!food) return null;
    return {
      food,
      lots: lotsResult.rows.map((lot) => ({
        ...lot,
        purchased_at: lot.purchased_at.toISOString(),
        expires_at: lot.expires_at?.toISOString() ?? null,
        expiry_status: computeExpiryStatus(lot.expires_at, now),
      })),
      transactions: txResult.rows,
    };
  }
}
