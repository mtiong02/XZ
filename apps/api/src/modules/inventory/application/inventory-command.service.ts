import { Inject, Injectable } from '@nestjs/common';
import Big from 'big.js';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  AddInventoryPayloadSchema,
  ConsumeInventoryPayloadSchema,
  CorrectInventoryPayloadSchema,
  DiscardInventoryPayloadSchema,
  MoveInventoryPayloadSchema,
  ReverseTransactionPayloadSchema,
  type CommandResult,
} from '@xz/contracts';
import { ENV, type Env } from '../../../config/env';
import { PG_POOL } from '../../../infra/db/database.module';
import { withTransaction } from '../../../infra/db/transaction';
import { MembershipService } from '../../household/membership.service';
import { AlreadyReversedError, DomainError, NotReversibleError } from '../domain/errors';
import { allocateFefo, type LotSnapshot } from '../domain/fefo';
import {
  formatQuantity,
  normalizeQuantityForStorage,
  parseQuantity,
  type UnitMap,
} from '../domain/quantity';
import type { CommandRequest } from './command-request';

interface CommandContext {
  client: PoolClient;
  householdId: string;
  actorMemberId: string;
  units: UnitMap;
  now: Date;
}

interface OutboxEventDraft {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

interface HandlerOutcome {
  transactionId: string;
  events: OutboxEventDraft[];
}

interface FoodRow {
  id: string;
  canonical_name: string;
  default_unit_code: string;
  default_shelf_life_days: number | null;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class InventoryCommandService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(ENV) private readonly env: Env,
    @Inject(MembershipService) private readonly membership: MembershipService,
  ) {}

  async execute(request: CommandRequest, userId: string): Promise<CommandResult> {
    const membership = await this.membership.assertMembership(request.household_id, userId);

    // 幂等快路径：同 key 已执行过则返回原结果（docs/01 业务规则 10）
    const existing = await this.findByIdempotencyKey(request);
    if (existing) return existing;

    const units = await this.loadUnits();
    const commandId = `cmd_${randomUUID()}`;

    try {
      return await withTransaction(this.pool, async (client) => {
        const ctx: CommandContext = {
          client,
          householdId: request.household_id,
          actorMemberId: membership.memberId,
          units,
          now: new Date(),
        };
        const outcome = await this.dispatch(ctx, request);
        const revision = await this.bumpRevision(client, request.household_id);
        await this.writeOutbox(client, request, outcome, revision);

        const result: CommandResult = {
          command_id: commandId,
          transaction_id: outcome.transactionId,
          idempotent_replay: false,
          revision,
        };
        await client.query(
          `update inventory_transactions
           set metadata_json = metadata_json || jsonb_build_object('result', $2::jsonb)
           where id = $1`,
          [outcome.transactionId, JSON.stringify(result)],
        );
        return result;
      });
    } catch (error) {
      // 并发重复提交：唯一约束兜底后重放已存结果
      if (this.isIdempotencyViolation(error)) {
        const replay = await this.findByIdempotencyKey(request);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async dispatch(ctx: CommandContext, request: CommandRequest): Promise<HandlerOutcome> {
    switch (request.command_type) {
      case 'ADD_INVENTORY':
        return this.handleAdd(ctx, request);
      case 'CONSUME_INVENTORY':
        return this.handleConsumeOrDiscard(ctx, request, 'CONSUME');
      case 'DISCARD_INVENTORY':
        return this.handleConsumeOrDiscard(ctx, request, 'DISCARD');
      case 'CORRECT_INVENTORY':
        return this.handleCorrect(ctx, request);
      case 'MOVE_INVENTORY':
        return this.handleMove(ctx, request);
      case 'REVERSE_TRANSACTION':
        return this.handleReverse(ctx, request);
    }
  }

  // ---------- ADD ----------

  private async handleAdd(ctx: CommandContext, request: CommandRequest): Promise<HandlerOutcome> {
    const payload = AddInventoryPayloadSchema.parse(request.payload);
    const foodIds = new Set(payload.items.map((i) => i.food_id));
    const events: OutboxEventDraft[] = [];
    const entries: { lotId: string; delta: Big; unit: string }[] = [];

    for (const item of payload.items) {
      const food = await this.resolveFood(ctx, item.food_id);
      const defaultZoneId = await this.getDefaultZoneId(ctx, food.id);
      const normalized = normalizeQuantityForStorage(
        parseQuantity(item.quantity),
        item.unit,
        ctx.units,
      );
      const quantity = normalized.quantity;
      const storageUnit = normalized.unit;
      const zoneId = item.storage_zone_id ?? defaultZoneId;
      await this.assertZoneInHousehold(ctx, zoneId);
      await this.assertStorageRule(ctx, food, zoneId);

      let expiresAt: Date | null = item.expires_at ? new Date(item.expires_at) : null;
      let expirySource = item.expiry_source;
      if (!expiresAt && food.default_shelf_life_days !== null) {
        expiresAt = new Date(
          ctx.now.getTime() + food.default_shelf_life_days * 24 * 60 * 60 * 1000,
        );
        expirySource = 'RULE_ESTIMATED';
      }

      const lot = (
        await ctx.client.query<{ id: string }>(
          `insert into inventory_lots
             (household_id, refrigerator_id, storage_zone_id, food_id,
              initial_quantity, remaining_quantity, unit_code,
              expires_at, expiry_source, created_by_member_id)
           select $1, sz.refrigerator_id, sz.id, $2, $3, $3, $4, $5, $6, $7
           from storage_zones sz where sz.id = $8
           returning id`,
          [
            ctx.householdId,
            food.id,
            formatQuantity(quantity),
            storageUnit,
            expiresAt,
            expirySource,
            ctx.actorMemberId,
            zoneId,
          ],
        )
      ).rows[0];
      if (!lot) throw new Error('lot insert returned no row');

      entries.push({ lotId: lot.id, delta: quantity, unit: storageUnit });
      events.push({
        eventType: 'InventoryLotCreated',
        aggregateType: 'inventory_lot',
        aggregateId: lot.id,
        payload: {
          lot_id: lot.id,
          food_id: food.id,
          food_name: food.canonical_name,
          quantity: formatQuantity(quantity),
          unit: storageUnit,
          expires_at: expiresAt?.toISOString() ?? null,
          expiry_source: expirySource,
        },
      });
    }

    const transactionId = await this.insertTransaction(ctx, request, 'ADD', {
      foodId: foodIds.size === 1 ? [...foodIds][0] : undefined,
      metadata: { item_count: payload.items.length },
    });
    await this.insertEntries(ctx, transactionId, entries);
    return { transactionId, events };
  }

  // ---------- CONSUME / DISCARD ----------

  private async handleConsumeOrDiscard(
    ctx: CommandContext,
    request: CommandRequest,
    type: 'CONSUME' | 'DISCARD',
  ): Promise<HandlerOutcome> {
    const payload =
      type === 'CONSUME'
        ? ConsumeInventoryPayloadSchema.parse(request.payload)
        : DiscardInventoryPayloadSchema.parse(request.payload);

    const events: OutboxEventDraft[] = [];
    const entries: { lotId: string; delta: Big; unit: string }[] = [];
    const foodIds = new Set(payload.items.map((i) => i.food_id));

    for (const item of payload.items) {
      const food = await this.resolveFood(ctx, item.food_id);
      const normalized = normalizeQuantityForStorage(
        parseQuantity(item.quantity),
        item.unit,
        ctx.units,
      );
      const requested = normalized.quantity;
      const storageUnit = normalized.unit;

      const targetLotId = 'lot_id' in item ? item.lot_id : undefined;
      const lots = await this.lockActiveLots(ctx, food.id, storageUnit, targetLotId);
      const allocations = allocateFefo(food.id, storageUnit, lots, requested);

      for (const allocation of allocations) {
        await this.applyLotDelta(ctx, allocation.lotId, allocation.quantity.neg());
        entries.push({
          lotId: allocation.lotId,
          delta: allocation.quantity.neg(),
          unit: storageUnit,
        });
      }

      events.push({
        eventType: type === 'CONSUME' ? 'InventoryConsumed' : 'InventoryDiscarded',
        aggregateType: 'food_inventory',
        aggregateId: food.id,
        payload: {
          food_id: food.id,
          food_name: food.canonical_name,
          quantity: formatQuantity(requested),
          unit: storageUnit,
          ...(type === 'CONSUME'
            ? { purpose: (payload as { purpose?: string }).purpose ?? 'UNKNOWN' }
            : { reason: (payload as { reason: string }).reason }),
          allocations: allocations.map((a) => ({
            lot_id: a.lotId,
            quantity: formatQuantity(a.quantity),
          })),
        },
      });
    }

    const metadata: Record<string, unknown> = { item_count: payload.items.length };
    if (type === 'CONSUME') {
      // purpose 不是个人摄入事实（docs/03 §4.2、ADR-009）
      metadata.purpose = (payload as { purpose?: string }).purpose ?? 'UNKNOWN';
    } else {
      metadata.reason = (payload as { reason: string }).reason;
    }

    const transactionId = await this.insertTransaction(ctx, request, type, {
      foodId: foodIds.size === 1 ? [...foodIds][0] : undefined,
      metadata,
    });
    await this.insertEntries(ctx, transactionId, entries);
    return { transactionId, events };
  }

  // ---------- CORRECT ----------

  private async handleCorrect(
    ctx: CommandContext,
    request: CommandRequest,
  ): Promise<HandlerOutcome> {
    const payload = CorrectInventoryPayloadSchema.parse(request.payload);
    const food = await this.resolveFood(ctx, payload.food_id);
    const normalized = normalizeQuantityForStorage(
      new Big(payload.target_total_quantity),
      payload.unit,
      ctx.units,
    );
    const target = normalized.quantity;
    const storageUnit = normalized.unit;

    const lots = await this.lockActiveLots(ctx, food.id, storageUnit);
    const current = lots.reduce((sum, lot) => sum.plus(lot.remainingQuantity), new Big(0));
    const delta = target.minus(current);
    const entries: { lotId: string; delta: Big; unit: string }[] = [];

    if (delta.gt(0)) {
      const defaultZoneId = await this.getDefaultZoneId(ctx, food.id);
      const lot = (
        await ctx.client.query<{ id: string }>(
          `insert into inventory_lots
             (household_id, refrigerator_id, storage_zone_id, food_id,
              initial_quantity, remaining_quantity, unit_code,
              expires_at, expiry_source, created_by_member_id)
           select $1, sz.refrigerator_id, sz.id, $2, $3, $3, $4, null, 'UNKNOWN', $5
           from storage_zones sz where sz.id = $6
           returning id`,
          [
            ctx.householdId,
            food.id,
            formatQuantity(delta),
            storageUnit,
            ctx.actorMemberId,
            defaultZoneId,
          ],
        )
      ).rows[0];
      if (!lot) throw new Error('correction lot insert returned no row');
      entries.push({ lotId: lot.id, delta, unit: storageUnit });
    } else if (delta.lt(0)) {
      const allocations = allocateFefo(food.id, storageUnit, lots, delta.abs());
      for (const allocation of allocations) {
        await this.applyLotDelta(ctx, allocation.lotId, allocation.quantity.neg());
        entries.push({
          lotId: allocation.lotId,
          delta: allocation.quantity.neg(),
          unit: storageUnit,
        });
      }
    }

    // 修正必须保留前后值、理由与操作者（FR-009）
    const transactionId = await this.insertTransaction(ctx, request, 'CORRECT', {
      foodId: food.id,
      metadata: {
        reason: payload.reason,
        before_total: formatQuantity(current),
        after_total: formatQuantity(target),
        unit: storageUnit,
      },
    });
    await this.insertEntries(ctx, transactionId, entries);

    return {
      transactionId,
      events: [
        {
          eventType: 'InventoryCorrected',
          aggregateType: 'food_inventory',
          aggregateId: food.id,
          payload: {
            food_id: food.id,
            food_name: food.canonical_name,
            before_total: formatQuantity(current),
            after_total: formatQuantity(target),
            unit: storageUnit,
            reason: payload.reason,
          },
        },
      ],
    };
  }

  // ---------- MOVE ----------

  private async handleMove(ctx: CommandContext, request: CommandRequest): Promise<HandlerOutcome> {
    const payload = MoveInventoryPayloadSchema.parse(request.payload);
    await this.assertZoneInHousehold(ctx, payload.target_storage_zone_id);
    const lots = (
      await ctx.client.query<{
        id: string;
        food_id: string;
        storage_zone_id: string;
      }>(
        `select id,food_id,storage_zone_id from inventory_lots
         where id=any($1::uuid[]) and household_id=$2 and status='ACTIVE' and remaining_quantity>0
         for update`,
        [payload.lot_ids, ctx.householdId],
      )
    ).rows;
    if (lots.length !== new Set(payload.lot_ids).size) {
      throw new DomainError('NOT_FOUND', 'LOT_NOT_FOUND', '部分库存批次不存在或已用完。');
    }

    const moves: Array<{ lot_id: string; from_zone_id: string; to_zone_id: string }> = [];
    const foodIds = new Set<string>();
    for (const lot of lots) {
      const food = await this.resolveFood(ctx, lot.food_id);
      await this.assertStorageRule(ctx, food, payload.target_storage_zone_id);
      foodIds.add(food.id);
      if (lot.storage_zone_id === payload.target_storage_zone_id) continue;
      await ctx.client.query(
        `update inventory_lots set storage_zone_id=$2,version=version+1,updated_at=now() where id=$1`,
        [lot.id, payload.target_storage_zone_id],
      );
      moves.push({
        lot_id: lot.id,
        from_zone_id: lot.storage_zone_id,
        to_zone_id: payload.target_storage_zone_id,
      });
    }
    if (moves.length === 0) {
      throw new DomainError('VALIDATION', 'ALREADY_IN_STORAGE_ZONE', '这些食材已在目标区域。');
    }
    const transactionId = await this.insertTransaction(ctx, request, 'MOVE', {
      foodId: foodIds.size === 1 ? [...foodIds][0] : undefined,
      metadata: { reason: payload.reason, moves },
    });
    return {
      transactionId,
      events: [
        {
          eventType: 'InventoryLotsMoved',
          aggregateType: 'inventory',
          aggregateId: ctx.householdId,
          payload: { lot_ids: moves.map((move) => move.lot_id) },
        },
      ],
    };
  }

  // ---------- REVERSE ----------

  private async handleReverse(
    ctx: CommandContext,
    request: CommandRequest,
  ): Promise<HandlerOutcome> {
    const payload = ReverseTransactionPayloadSchema.parse(request.payload);

    const original = (
      await ctx.client.query<{
        id: string;
        transaction_type: string;
        food_id: string | null;
        created_at: Date;
        metadata_json: Record<string, unknown>;
      }>(
        `select id, transaction_type, food_id, created_at, metadata_json
         from inventory_transactions
         where id = $1 and household_id = $2
         for update`,
        [payload.transaction_id, ctx.householdId],
      )
    ).rows[0];
    if (!original) {
      throw new DomainError('NOT_FOUND', 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    }
    if (original.transaction_type === 'REVERSAL') {
      throw new NotReversibleError(original.id, 'A reversal transaction cannot be reversed.');
    }

    const alreadyReversed = await ctx.client.query(
      `select 1 from inventory_transactions where reversed_transaction_id = $1`,
      [original.id],
    );
    if ((alreadyReversed.rowCount ?? 0) > 0) throw new AlreadyReversedError(original.id);

    const windowMs = this.env.REVERSAL_WINDOW_HOURS * 60 * 60 * 1000;
    if (ctx.now.getTime() - original.created_at.getTime() > windowMs) {
      throw new NotReversibleError(
        original.id,
        `Reversal window of ${this.env.REVERSAL_WINDOW_HOURS}h has passed.`,
      );
    }

    if (original.transaction_type === 'MOVE') {
      const moves = original.metadata_json.moves;
      if (!Array.isArray(moves)) {
        throw new NotReversibleError(original.id, 'Move history is incomplete.');
      }
      for (const value of moves) {
        const move = value as { lot_id?: unknown; from_zone_id?: unknown; to_zone_id?: unknown };
        if (
          typeof move.lot_id !== 'string' ||
          typeof move.from_zone_id !== 'string' ||
          typeof move.to_zone_id !== 'string'
        ) {
          throw new NotReversibleError(original.id, 'Move history is invalid.');
        }
        const result = await ctx.client.query(
          `update inventory_lots set storage_zone_id=$2,version=version+1,updated_at=now()
           where id=$1 and household_id=$3 and storage_zone_id=$4`,
          [move.lot_id, move.from_zone_id, ctx.householdId, move.to_zone_id],
        );
        if ((result.rowCount ?? 0) !== 1) {
          throw new NotReversibleError(original.id, '该批次已再次移动，无法撤销本次移动。');
        }
      }
      const transactionId = await this.insertTransaction(ctx, request, 'REVERSAL', {
        foodId: original.food_id ?? undefined,
        reversedTransactionId: original.id,
        metadata: { reason: payload.reason, original_type: original.transaction_type },
      });
      return {
        transactionId,
        events: [
          {
            eventType: 'InventoryMoveReversed',
            aggregateType: 'inventory_transaction',
            aggregateId: original.id,
            payload: { original_transaction_id: original.id },
          },
        ],
      };
    }

    const originalEntries = (
      await ctx.client.query<{ lot_id: string; quantity_delta: string; unit_code: string }>(
        `select e.lot_id, e.quantity_delta, e.unit_code
         from inventory_transaction_entries e
         where e.transaction_id = $1`,
        [original.id],
      )
    ).rows;

    // 锁定涉及批次并校验反向后不出现负库存
    const entries: { lotId: string; delta: Big; unit: string }[] = [];
    for (const entry of originalEntries) {
      const lot = (
        await ctx.client.query<{ remaining_quantity: string }>(
          `select remaining_quantity from inventory_lots where id = $1 for update`,
          [entry.lot_id],
        )
      ).rows[0];
      if (!lot) throw new NotReversibleError(original.id, 'Referenced lot no longer exists.');

      const reversalDelta = new Big(entry.quantity_delta).neg();
      const newRemaining = new Big(lot.remaining_quantity).plus(reversalDelta);
      if (newRemaining.lt(0)) {
        throw new NotReversibleError(
          original.id,
          'Stock from this transaction has already been used.',
        );
      }
      entries.push({ lotId: entry.lot_id, delta: reversalDelta, unit: entry.unit_code });
    }
    for (const entry of entries) {
      await this.applyLotDelta(ctx, entry.lotId, entry.delta);
    }

    const transactionId = await this.insertTransaction(ctx, request, 'REVERSAL', {
      foodId: original.food_id ?? undefined,
      reversedTransactionId: original.id,
      metadata: { reason: payload.reason, original_type: original.transaction_type },
    });
    await this.insertEntries(ctx, transactionId, entries);

    return {
      transactionId,
      events: [
        {
          eventType: 'InventoryTransactionReversed',
          aggregateType: 'inventory_transaction',
          aggregateId: original.id,
          payload: {
            original_transaction_id: original.id,
            reversal_transaction_id: transactionId,
            reason: payload.reason,
          },
        },
      ],
    };
  }

  // ---------- helpers ----------

  private async loadUnits(): Promise<UnitMap> {
    const result = await this.pool.query<{
      code: string;
      kind: 'COUNT' | 'MASS' | 'VOLUME';
      base_factor: string;
    }>(`select code, kind, base_factor from units`);
    return new Map(
      result.rows.map((row) => [
        row.code,
        { code: row.code, kind: row.kind, baseFactor: row.base_factor },
      ]),
    );
  }

  private async resolveFood(ctx: CommandContext, foodId: string): Promise<FoodRow> {
    const result = await ctx.client.query<FoodRow>(
      `select id, canonical_name, default_unit_code, default_shelf_life_days
       from food_catalog
       where id = $1 and (household_id is null or household_id = $2)`,
      [foodId, ctx.householdId],
    );
    const food = result.rows[0];
    if (!food) throw new DomainError('NOT_FOUND', 'FOOD_NOT_FOUND', 'Food not found.');
    return food;
  }

  private async getDefaultZoneId(ctx: CommandContext, foodId: string): Promise<string> {
    const result = await ctx.client.query<{ id: string }>(
      `select sz.id from storage_zones sz
       left join food_storage_rules fsr on fsr.food_id=$2 and fsr.storage_zone_code=sz.code
       where sz.household_id=$1 and (fsr.suitability='RECOMMENDED' or sz.code='FRIDGE')
       order by case when fsr.suitability='RECOMMENDED' then 0 else 1 end, sz.position limit 1`,
      [ctx.householdId, foodId],
    );
    const zone = result.rows[0];
    if (!zone) {
      throw new DomainError('NOT_FOUND', 'ZONE_NOT_FOUND', 'No default storage zone.');
    }
    return zone.id;
  }

  private async assertStorageRule(ctx: CommandContext, food: FoodRow, zoneId: string) {
    const result = await ctx.client.query<{ suitability: string; condition_note: string }>(
      `select fsr.suitability,fsr.condition_note from storage_zones sz
       join food_storage_rules fsr on fsr.food_id=$2 and fsr.storage_zone_code=sz.code
       where sz.id=$1 and sz.household_id=$3`,
      [zoneId, food.id, ctx.householdId],
    );
    const rule = result.rows[0];
    if (rule?.suitability === 'PROHIBITED') {
      throw new DomainError(
        'VALIDATION',
        'FOOD_STORAGE_ZONE_PROHIBITED',
        `${food.canonical_name}不适合放在这个区域。${rule.condition_note}`,
      );
    }
  }

  private async assertZoneInHousehold(ctx: CommandContext, zoneId: string): Promise<void> {
    const result = await ctx.client.query(
      `select 1 from storage_zones where id = $1 and household_id = $2`,
      [zoneId, ctx.householdId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new DomainError('NOT_FOUND', 'ZONE_NOT_FOUND', 'Storage zone not found.');
    }
  }

  private async lockActiveLots(
    ctx: CommandContext,
    foodId: string,
    unitCode: string,
    lotId?: string,
  ): Promise<LotSnapshot[]> {
    const result = await ctx.client.query<{
      id: string;
      remaining_quantity: string;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `select id, remaining_quantity, expires_at, created_at
       from inventory_lots
       where household_id = $1 and food_id = $2 and status = 'ACTIVE'
         and remaining_quantity > 0 and unit_code = $3
         and ($4::uuid is null or id = $4)
       order by id
       for update`,
      [ctx.householdId, foodId, unitCode, lotId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      remainingQuantity: new Big(row.remaining_quantity),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  private async applyLotDelta(ctx: CommandContext, lotId: string, delta: Big): Promise<void> {
    const result = await ctx.client.query<{ remaining_quantity: string }>(
      `update inventory_lots
       set remaining_quantity = remaining_quantity + $2,
           status = case when remaining_quantity + $2 <= 0 then 'DEPLETED' else 'ACTIVE' end,
           version = version + 1,
           updated_at = now()
       where id = $1
       returning remaining_quantity`,
      [lotId, formatQuantity(delta)],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new DomainError('NOT_FOUND', 'LOT_NOT_FOUND', 'Inventory lot not found.');
    }
  }

  private async insertTransaction(
    ctx: CommandContext,
    request: CommandRequest,
    type: 'ADD' | 'CONSUME' | 'DISCARD' | 'CORRECT' | 'MOVE' | 'REVERSAL',
    options: {
      foodId?: string | undefined;
      reversedTransactionId?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
    },
  ): Promise<string> {
    const result = await ctx.client.query<{ id: string }>(
      `insert into inventory_transactions
         (household_id, transaction_type, food_id, source_channel, actor_member_id,
          interaction_id, idempotency_key, reversed_transaction_id, metadata_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        ctx.householdId,
        type,
        options.foodId ?? null,
        request.source.channel,
        ctx.actorMemberId,
        request.source.interaction_id ?? null,
        request.idempotency_key,
        options.reversedTransactionId ?? null,
        JSON.stringify(options.metadata ?? {}),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('transaction insert returned no row');
    return row.id;
  }

  private async insertEntries(
    ctx: CommandContext,
    transactionId: string,
    entries: { lotId: string; delta: Big; unit: string }[],
  ): Promise<void> {
    for (const entry of entries) {
      await ctx.client.query(
        `insert into inventory_transaction_entries (transaction_id, lot_id, quantity_delta, unit_code)
         values ($1, $2, $3, $4)`,
        [transactionId, entry.lotId, formatQuantity(entry.delta), entry.unit],
      );
    }
  }

  private async bumpRevision(client: PoolClient, householdId: string): Promise<number> {
    const result = await client.query<{ revision: string }>(
      `update inventory_revisions
       set revision = revision + 1, updated_at = now()
       where household_id = $1
       returning revision`,
      [householdId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('inventory_revisions row missing');
    return Number(row.revision);
  }

  private async writeOutbox(
    client: PoolClient,
    request: CommandRequest,
    outcome: HandlerOutcome,
    revision: number,
  ): Promise<void> {
    for (const event of outcome.events) {
      await client.query(
        `insert into outbox_events
           (event_type, schema_version, aggregate_type, aggregate_id, household_id,
            correlation_id, payload_json)
         values ($1, '1.0', $2, $3, $4, $5, $6)`,
        [
          event.eventType,
          event.aggregateType,
          event.aggregateId,
          request.household_id,
          outcome.transactionId,
          JSON.stringify({ ...event.payload, revision }),
        ],
      );
    }
  }

  private async findByIdempotencyKey(request: CommandRequest): Promise<CommandResult | null> {
    const result = await this.pool.query<{ id: string; metadata_json: { result?: CommandResult } }>(
      `select id, metadata_json from inventory_transactions
       where household_id = $1 and idempotency_key = $2`,
      [request.household_id, request.idempotency_key],
    );
    const row = result.rows[0];
    if (!row) return null;
    const stored = row.metadata_json.result;
    if (stored) return { ...stored, idempotent_replay: true };
    // 极端情况：结果未写入（旧数据），返回最小重放信息
    return {
      command_id: `cmd_replay_${row.id}`,
      transaction_id: row.id,
      idempotent_replay: true,
      revision: -1,
    };
  }

  private isIdempotencyViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
      'constraint' in error &&
      (error as { constraint?: string }).constraint === 'inventory_transactions_idempotency_uq'
    );
  }
}
