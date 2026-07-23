import { Inject, Injectable, Optional } from '@nestjs/common';
import Big from 'big.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ChannelSchema, COMMAND_PAYLOAD_SCHEMAS, type InventoryZoneView } from '@xz/contracts';
import { PG_POOL } from '../../infra/db/database.module';
import { FoodCategoryService } from '../food-knowledge/food-category.service';
import { MembershipService } from '../household/membership.service';
import { InventoryCommandService } from '../inventory/application/inventory-command.service';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';
import { DomainError } from '../inventory/domain/errors';
import { MealPlanningService } from '../meal-planning/meal-planning.service';
import {
  NotificationService,
  normalizeReminderSpeech,
  parseReminderSchedule,
} from '../notification/notification.service';
import { normalizeTranscript } from './parser/normalizer';
import {
  BATCH_COMMIT_PATTERN,
  isReasonableUnitForFood,
  parseTranscript,
  requestedStorageZoneCode,
  suggestedUnitsForFood,
  type FoodCatalogEntry,
  type ParseResult,
} from './parser/intent-parser';
import { interpretReply, relativeInventoryFraction } from './dialogue/reply-interpreter';
import {
  CANCELLED_PROMPT,
  clarifyQuantityPrompt,
  clarifyUnitPrompt,
  confirmPrompt,
  correctedPrompt,
  executedPrompt,
  UNCLEAR_PROMPT,
  UNRECOGNIZED_PROMPT,
  type SpokenItem,
} from './dialogue/prompts';
import { unitSpokenLabel } from './dialogue/units-spoken';
import { AgentToolExecutor } from '../agent-runtime/agent-tool-executor';
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service';
import { TurnCoordinatorService } from '../agent-runtime/turn-coordinator.service';

export const CreateTextVoiceJobSchema = z.object({
  household_id: z.string().uuid(),
  transcript_text: z.string().min(1).max(200),
  locale: z.string().max(10).default('zh'),
  channel: ChannelSchema.default('WEB_VOICE'),
  client_request_id: z.string().max(100).optional(),
  session_id: z.string().uuid().optional(),
  turn_id: z.string().uuid().optional(),
});

export const ConfirmVoiceJobSchema = z.object({
  payload: z.unknown(),
});

export const ReplyVoiceJobSchema = z.object({
  text: z.string().min(1).max(200),
  turn_id: z.string().uuid().optional(),
});

export const MealFeedbackSchema = z.object({
  outcome: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']),
  note: z.string().trim().max(200).optional(),
});

export interface CandidateItem {
  food_id: string;
  display_text?: string;
  quantity: string;
  unit: string;
  quantity_explicit?: boolean;
  storage_zone_id?: string;
}

type CandidatePayload = {
  items?: CandidateItem[];
  food_id?: string;
  food_name?: string;
  reminder_text?: string;
  scheduled_for?: string;
  reminder_id?: string;
  lot_ids?: string[];
  target_storage_zone_id?: string;
  reason?: string;
  request_text?: string;
};

export interface DialogueTurn {
  role: 'user' | 'system';
  text: string;
  at: string;
}

interface VoiceJobRow {
  id: string;
  household_id: string;
  status: string;
  transcript_raw: string | null;
  transcript_normalized: string | null;
  candidate_command_json: {
    command_type?: string;
    payload?: CandidatePayload;
  } | null;
  confidence_json: unknown;
  requires_confirmation: boolean;
  error_code: string | null;
  source_channel: string;
  executed_transaction_id: string | null;
  spoken_prompt: string | null;
  turn_count: number;
  dialogue_turns: DialogueTurn[];
  created_at: Date;
  completed_at: Date | null;
  session_id: string | null;
  turn_id: string | null;
}

const REPLIABLE_STATUSES = new Set(['AWAITING_CONFIRMATION', 'AWAITING_CLARIFICATION']);
const READ_ONLY_QUERY_INTENTS = new Set([
  'QUERY_INVENTORY',
  'QUERY_REMINDERS',
  'QUERY_SHOPPING_LIST',
]);

const JOB_COLUMNS = `id, household_id, status, transcript_raw, transcript_normalized,
       candidate_command_json, confidence_json, requires_confirmation, error_code,
       source_channel, executed_transaction_id, spoken_prompt, turn_count, dialogue_turns,
       created_at, completed_at, session_id, turn_id`;

const INTENT_TO_COMMAND: Record<string, string> = {
  ADD_INVENTORY: 'ADD_INVENTORY',
  CONSUME_INVENTORY: 'CONSUME_INVENTORY',
  DISCARD_INVENTORY: 'DISCARD_INVENTORY',
};

@Injectable()
export class VoiceService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly membership: MembershipService,
    @Inject(InventoryCommandService) private readonly commands: InventoryCommandService,
    @Inject(InventoryQueryService) private readonly queries: InventoryQueryService,
    @Inject(FoodCategoryService) private readonly foodCategories: FoodCategoryService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(MealPlanningService) private readonly meals: MealPlanningService,
    @Optional()
    @Inject(TurnCoordinatorService)
    private readonly coordinator?: TurnCoordinatorService,
    @Optional() @Inject(AgentRuntimeService) private readonly runtime?: AgentRuntimeService,
    @Optional() @Inject(AgentToolExecutor) private readonly toolExecutor?: AgentToolExecutor,
  ) {}

  /**
   * 文本通道：Web Speech / 手动输入的文本进入同一解析流水线。
   * ASR 文本 -> Normalizer -> Parser -> 候选命令 -> 等待确认（docs/02 §10.2）。
   */
  async createTextJob(userId: string, input: z.infer<typeof CreateTextVoiceJobSchema>) {
    const membership = await this.membership.assertMembership(input.household_id, userId);

    if (input.client_request_id) {
      const existing = await this.pool.query<{ id: string }>(
        `select id from voice_jobs where household_id = $1 and client_request_id = $2`,
        [input.household_id, input.client_request_id],
      );
      const row = existing.rows[0];
      if (row) return this.getJob(row.id, userId);
    }

    const normalized = normalizeTranscript(input.transcript_text);
    const catalog = await this.loadCatalog(input.household_id);
    const parsed = parseTranscript(normalized, catalog);
    const sessionId = input.session_id ?? randomUUID();
    const turnId = input.turn_id ?? randomUUID();
    const taskId = randomUUID();
    const task = this.coordinator?.begin({
      householdId: input.household_id,
      memberId: membership.memberId,
      taskId,
      sessionId,
      intent: parsed.intent,
    });
    const outcome =
      parsed.intent === 'CREATE_REMINDER'
        ? await this.buildReminderOutcome(input.household_id, userId, input.transcript_text, parsed)
        : parsed.intent === 'QUERY_REMINDERS'
          ? await this.buildReminderQueryOutcome(
              input.household_id,
              userId,
              normalized,
              membership.timezone,
            )
          : parsed.intent === 'QUERY_SHOPPING_LIST'
            ? await this.buildShoppingListQueryOutcome(input.household_id, userId)
            : parsed.intent === 'REMOVE_SHOPPING_ITEM'
              ? await this.buildUpdateShoppingItemStatusOutcome(
                  input.household_id,
                  userId,
                  parsed,
                  'CANCELLED',
                )
              : parsed.intent === 'MARK_SHOPPING_PURCHASED'
                ? await this.buildUpdateShoppingItemStatusOutcome(
                    input.household_id,
                    userId,
                    parsed,
                    'PURCHASED',
                  )
                : parsed.intent === 'MOVE_INVENTORY'
                  ? await this.buildMoveOutcome(input.household_id, userId, normalized, parsed)
                  : this.buildOutcome(parsed);
    const superseded = Boolean(
      task &&
      this.coordinator?.getActive(input.household_id, membership.memberId)?.taskId !== taskId,
    );
    if (superseded) {
      outcome.status = 'CANCELLED';
      outcome.candidate = null;
      outcome.errorCode = 'TASK_SUPERSEDED';
      outcome.spokenPrompt = null;
    }
    await this.applyRequestedStorageZone(input.household_id, normalized, outcome.candidate);
    if (parsed.intent === 'QUERY_INVENTORY' && !superseded) {
      const mealClarification = isMealDecisionRequest(normalized)
        ? await this.meals.getMealContextClarification(input.household_id, userId, normalized)
        : null;
      if (mealClarification) {
        outcome.status = 'AWAITING_CLARIFICATION';
        outcome.candidate = {
          command_type: 'MEAL_RECOMMENDATION',
          payload: { request_text: input.transcript_text },
        };
        outcome.errorCode = null;
        outcome.spokenPrompt = mealClarification;
      } else {
        outcome.spokenPrompt = await this.buildInventoryQueryPrompt(
          input.household_id,
          userId,
          normalized,
          parsed,
          { taskId, signal: task ? this.coordinator?.getSignal(taskId) : undefined },
        );
      }
    }
    const firstTurn: DialogueTurn[] = [{ role: 'user', text: input.transcript_text, at: nowIso() }];
    if (outcome.spokenPrompt) {
      firstTurn.push({ role: 'system', text: outcome.spokenPrompt, at: nowIso() });
    }

    const inserted = await this.pool.query<{ id: string }>(
      `insert into voice_jobs
         (id, household_id, actor_member_id, status, locale, source_channel, input_mode,
          transcript_raw, transcript_normalized, candidate_command_json, confidence_json,
          requires_confirmation, error_code, client_request_id, spoken_prompt, turn_count,
          dialogue_turns, session_id, turn_id)
       values ($1, $2, $3, $4, $5, $6, 'TEXT', $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $16, $17)
       returning id`,
      [
        taskId,
        input.household_id,
        membership.memberId,
        outcome.status,
        input.locale,
        input.channel,
        input.transcript_text,
        normalized,
        outcome.candidate ? JSON.stringify(outcome.candidate) : null,
        JSON.stringify(parsed.confidence),
        outcome.candidate !== null &&
          !['QUERY_INVENTORY', 'MEAL_RECOMMENDATION'].includes(outcome.candidate.command_type),
        outcome.errorCode,
        input.client_request_id ?? null,
        outcome.spokenPrompt,
        JSON.stringify(firstTurn),
        sessionId,
        turnId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('voice job insert returned no row');
    void this.runtime?.recordEvent({
      householdId: input.household_id,
      actorMemberId: membership.memberId,
      sessionId: task?.sessionId,
      turnId: task?.turnId,
      taskId: row.id,
      eventType: 'CORE_INTENT_RECOGNIZED',
      intent: parsed.intent,
      outcome: outcome.status,
      metadata: {
        requires_confirmation:
          outcome.candidate !== null &&
          !['QUERY_INVENTORY', 'MEAL_RECOMMENDATION'].includes(outcome.candidate.command_type),
      },
    });
    void this.runtime?.recordEvent({
      householdId: input.household_id,
      actorMemberId: membership.memberId,
      sessionId: task?.sessionId,
      turnId: task?.turnId,
      taskId: row.id,
      eventType: 'TASK_CREATED',
      intent: parsed.intent,
      outcome: outcome.status,
    });
    if (
      parsed.intent === 'QUERY_INVENTORY' &&
      isMealDecisionRequest(normalized) &&
      outcome.status === 'COMPLETED'
    ) {
      void this.runtime?.recordEvent({
        householdId: input.household_id,
        actorMemberId: membership.memberId,
        sessionId: task?.sessionId,
        turnId: task?.turnId,
        taskId: row.id,
        eventType: 'MEAL_PLAN_GENERATED',
        intent: parsed.intent,
        outcome: 'generated',
      });
    }
    if (parsed.intent === 'ADD_SHOPPING_ITEM' && outcome.status === 'AWAITING_CONFIRMATION') {
      void this.runtime?.recordEvent({
        householdId: input.household_id,
        actorMemberId: membership.memberId,
        sessionId: task?.sessionId,
        turnId: task?.turnId,
        taskId: row.id,
        eventType: 'SHOPPING_DRAFT_CREATED',
        intent: parsed.intent,
        outcome: 'awaiting_confirmation',
      });
    }
    if (task && ['COMPLETED', 'FAILED'].includes(outcome.status)) {
      this.coordinator?.complete(row.id, outcome.status === 'FAILED' ? 'FAILED' : 'COMPLETED');
      void this.runtime?.recordEvent({
        householdId: input.household_id,
        actorMemberId: membership.memberId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: row.id,
        eventType: outcome.status === 'FAILED' ? 'VOICE_FAILURE' : 'TASK_COMPLETED',
        intent: parsed.intent,
        outcome: outcome.status,
        metadata: outcome.errorCode ? { error_code: outcome.errorCode } : undefined,
      });
    }
    return this.getJob(row.id, userId);
  }

  private buildOutcome(parsed: ParseResult): {
    status: string;
    candidate: { command_type: string; payload: CandidatePayload } | null;
    errorCode: string | null;
    spokenPrompt: string | null;
  } {
    if (parsed.intent === 'ADD_SHOPPING_ITEM') {
      const item = parsed.items[0];
      if (!item) {
        return {
          status: 'FAILED',
          candidate: null,
          errorCode: 'SHOPPING_FOOD_MISSING',
          spokenPrompt: '请告诉我要把哪种食材加入购物清单。',
        };
      }
      return {
        status: 'AWAITING_CONFIRMATION',
        candidate: {
          command_type: 'ADD_SHOPPING_ITEM',
          payload: { items: [toCandidateItem(item)] },
        },
        errorCode: null,
        spokenPrompt: `你是说，把${item.quantity_explicit ? `${item.quantity}${unitSpokenLabel(item.unit)}` : ''}${item.food_name}加入购物清单，对吗？`,
      };
    }
    if (parsed.intent === 'EXTERNAL_PURCHASE') {
      return {
        status: 'COMPLETED',
        candidate: null,
        errorCode: null,
        spokenPrompt:
          '我目前还不能代你向外部商家下单，也不会把尚未购买的商品记入库存。购物清单功能接通后，我可以先帮你加入清单。',
      };
    }
    if (parsed.intent === 'QUERY_INVENTORY') {
      return {
        status: 'COMPLETED',
        candidate: {
          command_type: 'QUERY_INVENTORY',
          payload: { items: parsed.items.map((item) => ({ ...toCandidateItem(item) })) },
        },
        errorCode: null,
        spokenPrompt: null,
      };
    }
    const commandType = INTENT_TO_COMMAND[parsed.intent];
    if (!commandType) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'AMBIGUOUS_COMMAND',
        spokenPrompt: UNRECOGNIZED_PROMPT,
      };
    }

    if (parsed.items.length === 0) {
      if (commandType === 'CONSUME_INVENTORY') {
        return {
          status: 'AWAITING_CLARIFICATION',
          candidate: { command_type: commandType, payload: { items: [] } },
          errorCode: null,
          spokenPrompt:
            '你想用掉哪种食材？先告诉我食材名称；如果你想让我按早餐、午餐或晚餐主动推荐，可以直接说“你来推荐”。',
        };
      }
      if (commandType === 'ADD_INVENTORY') {
        return {
          status: 'AWAITING_CLARIFICATION',
          candidate: { command_type: commandType, payload: { items: [] } },
          errorCode: null,
          spokenPrompt:
            '好的，已为你开启连续记录！你可以把食材和数量一句句告诉我，比如‘薏米一盒’、‘五指毛桃一袋’；报完后说‘就这些’或‘以上全部入库’即可。',
        };
      }
      const action = commandType === 'CONSUME_INVENTORY' ? '用掉' : '处理';
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate: { command_type: commandType, payload: { items: [] } },
        errorCode: null,
        spokenPrompt: `你想${action}什么食材？请把食材和数量一起告诉我。`,
      };
    }

    const items = parsed.items.map(toCandidateItem);
    const payload = buildPayload(commandType, items);
    const candidate = { command_type: commandType, payload };

    // 追问：单食材且数量未显式（"加牛奶" 未说几盒）-> 先问清楚再确认，不擅自默认（AGENTS.md §6）
    const parsedItem = parsed.items.length === 1 ? parsed.items[0] : undefined;
    if (parsedItem && !parsedItem.quantity_explicit) {
      const foodName = items[0]?.display_text ?? '这个';
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: clarifyQuantityPrompt(commandType, foodName, parsedItem.suggested_units),
      };
    }

    if (parsedItem && !parsedItem.unit_reasonable) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: clarifyUnitPrompt(
          parsedItem.food_name,
          parsedItem.quantity,
          parsedItem.unit,
          parsedItem.suggested_units,
        ),
      };
    }

    // 库存写操作一律需要用户确认（AGENTS.md §2）
    return {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      errorCode: null,
      spokenPrompt: confirmPrompt(commandType, toSpokenItems(items)),
    };
  }

  /**
   * “把猪肉移到冷冻室”是位置更正，不是新增或消耗。
   * 仅选择当前仍有余量的批次，仍必须由用户确认后才发出 MOVE_INVENTORY 命令。
   */
  private async buildMoveOutcome(
    householdId: string,
    userId: string,
    normalized: string,
    parsed: ParseResult,
  ): Promise<{
    status: string;
    candidate: { command_type: string; payload: CandidatePayload } | null;
    errorCode: string | null;
    spokenPrompt: string | null;
  }> {
    const targetCode = requestedStorageZoneCode(normalized);
    const foodIds = [...new Set(parsed.items.map((item) => item.food_id))];
    if (!targetCode || foodIds.length === 0) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'MOVE_FOOD_OR_ZONE_MISSING',
        spokenPrompt: '请说清要移动哪种食材和目标位置，例如“把猪肉移到冷冻室”。',
      };
    }
    const target = await this.pool.query<{ id: string; name: string }>(
      `select id, name from storage_zones where household_id=$1 and code=$2 limit 1`,
      [householdId, targetCode],
    );
    const targetZone = target.rows[0];
    if (!targetZone) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'MOVE_TARGET_ZONE_MISSING',
        spokenPrompt: '没有找到目标存放区域，请稍后在冰箱页面检查保鲜、冷冻和常温区。',
      };
    }
    const lots = await this.pool.query<{ id: string; canonical_name: string }>(
      `select l.id, fc.canonical_name
       from inventory_lots l
       join food_catalog fc on fc.id=l.food_id
       where l.household_id=$1 and l.food_id = any($2::uuid[])
         and l.status='ACTIVE' and l.remaining_quantity>0 and l.storage_zone_id<>$3
       order by fc.canonical_name, l.expires_at nulls last`,
      [householdId, foodIds, targetZone.id],
    );
    if (lots.rows.length === 0) {
      const names = parsed.items.map((item) => item.food_name).join('、');
      return {
        status: 'COMPLETED',
        candidate: null,
        errorCode: null,
        spokenPrompt: `${names}目前没有需要移动的在库批次。`,
      };
    }
    const names = [...new Set(lots.rows.map((lot) => lot.canonical_name))].join('、');

    // 目标食材与区域明确时，直接执行移动更新，一步到位生效
    try {
      await this.commands.execute(
        {
          command_type: 'MOVE_INVENTORY',
          schema_version: '1.0',
          household_id: householdId,
          source: {
            channel: 'WEB_VOICE',
            client: 'voice',
          },
          idempotency_key: `voice-move-${householdId}-${Date.now()}`,
          payload: {
            lot_ids: lots.rows.map((lot) => lot.id),
            target_storage_zone_id: targetZone.id,
            reason: 'USER_CHOICE',
          },
        },
        userId,
      );
      return {
        status: 'COMPLETED',
        candidate: null,
        errorCode: null,
        spokenPrompt: `好的，已帮您将${names}移动到${targetZone.name}了。`,
      };
    } catch {
      return {
        status: 'AWAITING_CONFIRMATION',
        candidate: {
          command_type: 'MOVE_INVENTORY',
          payload: {
            lot_ids: lots.rows.map((lot) => lot.id),
            target_storage_zone_id: targetZone.id,
            reason: 'USER_CHOICE',
          },
        },
        errorCode: null,
        spokenPrompt: `你是说，把${names}移到${targetZone.name}，对吗？`,
      };
    }
  }

  private async buildShoppingListQueryOutcome(householdId: string, userId: string) {
    const items = await this.meals.listShoppingItems(householdId, userId);
    const spokenPrompt = items.length
      ? `购物清单里有：${items
          .slice(0, 8)
          .map((item: { food_name: string; quantity: string | null; unit_code: string | null }) =>
            item.quantity && item.unit_code
              ? `${item.food_name}${item.quantity}${unitSpokenLabel(item.unit_code)}`
              : item.food_name,
          )
          .join('、')}。`
      : '购物清单还是空的。';
    return {
      status: 'COMPLETED',
      candidate: null,
      errorCode: null,
      spokenPrompt,
    };
  }

  private async buildUpdateShoppingItemStatusOutcome(
    householdId: string,
    userId: string,
    parsed: ParseResult,
    targetStatus: 'PURCHASED' | 'CANCELLED',
  ) {
    const foodIds = [...new Set(parsed.items.map((item) => item.food_id))];
    if (foodIds.length === 0) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'SHOPPING_FOOD_MISSING',
        spokenPrompt:
          targetStatus === 'PURCHASED'
            ? '请告诉我要把待购清单里的哪种食材标记为已购买。'
            : '请告诉我要从待购清单中移除哪种食材。',
      };
    }

    const activeItems = await this.pool.query<{ id: string; food_id: string; food_name: string }>(
      `select sli.id, sli.food_id, fc.canonical_name as food_name
       from shopping_list_items sli
       join food_catalog fc on fc.id = sli.food_id
       where sli.household_id = $1 and sli.status = 'PENDING' and sli.food_id = any($2::uuid[])`,
      [householdId, foodIds],
    );

    if (activeItems.rows.length === 0) {
      const names = parsed.items.map((item) => item.food_name).join('、');
      return {
        status: 'COMPLETED',
        candidate: null,
        errorCode: null,
        spokenPrompt: `待购清单里目前没有找到未购买的${names}。`,
      };
    }

    const updatedNames: string[] = [];
    for (const item of activeItems.rows) {
      await this.meals.updateShoppingItemStatus(householdId, item.id, userId, targetStatus);
      updatedNames.push(item.food_name);
    }

    const namesStr = [...new Set(updatedNames)].join('、');
    const spokenPrompt =
      targetStatus === 'PURCHASED'
        ? `好的，已将待购清单中的${namesStr}标记为已购买。`
        : `好的，已将${namesStr}从待购清单中移除。`;

    return {
      status: 'COMPLETED',
      candidate: null,
      errorCode: null,
      spokenPrompt,
    };
  }

  private async buildReminderQueryOutcome(
    householdId: string,
    userId: string,
    normalized: string,
    timezone: string,
  ) {
    const tasks = (await this.notifications.listReminderTasks(householdId, userId)) as Array<{
      reminder_text: string;
      scheduled_for: Date | string;
    }>;
    return {
      status: 'COMPLETED',
      candidate: null,
      errorCode: null,
      spokenPrompt: reminderQueryPrompt(tasks, normalized, timezone),
    };
  }

  private async buildReminderOutcome(
    householdId: string,
    userId: string,
    rawText: string,
    parsed: ParseResult,
  ): Promise<{
    status: string;
    candidate: {
      command_type: string;
      payload: {
        food_id?: string;
        food_name?: string;
        reminder_text?: string;
        scheduled_for?: string;
        request_text?: string;
      };
    } | null;
    errorCode: string | null;
    spokenPrompt: string | null;
  }> {
    const scheduled = parseReminderSchedule(rawText);
    const item = parsed.items[0];
    const relativeFraction = relativeInventoryFraction(rawText);
    const relativeFoodText =
      item && relativeFraction
        ? await this.resolveRelativeReminderText(
            householdId,
            userId,
            item.food_id,
            item.food_name,
            relativeFraction,
          )
        : null;
    const isPurchaseReminder = /买|购买|采购|补充|添置/.test(rawText);
    const genericText = extractReminderText(rawText);
    const foodText = isPurchaseReminder
      ? (genericText ?? (item ? reminderFoodText(item) : undefined))
      : item
        ? (relativeFoodText ?? reminderFoodText(item))
        : genericText;
    const editsExisting = /改成|改为|修改|调整/.test(rawText);
    const existingReminder =
      editsExisting && item
        ? await this.notifications.findPendingReminderForFood(householdId, userId, item.food_id)
        : null;
    const candidate = {
      command_type: existingReminder ? 'UPDATE_REMINDER' : 'CREATE_REMINDER',
      payload: {
        ...(item ? { food_id: item.food_id, food_name: item.food_name } : {}),
        ...(foodText ? { reminder_text: foodText } : {}),
        ...(scheduled ? { scheduled_for: scheduled.toISOString() } : {}),
        ...(existingReminder ? { reminder_id: existingReminder.id } : {}),
      },
    };
    if (editsExisting && item && !existingReminder) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'REMINDER_NOT_FOUND',
        spokenPrompt: `我没有找到待处理的${item.food_name}提醒。你可以让我新建一条。`,
      };
    }
    if (!scheduled) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: '你希望我在什么时候提醒？',
      };
    }
    if (!item && !foodText) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: '你想让我提醒你做什么？例如“明天买绿叶菜”或“明天吃药”。',
      };
    }
    if (relativeFraction && !relativeFoodText) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: `我暂时无法按当前库存换算${item?.food_name ?? '这项食材'}的一半。请告诉我要提醒你吃掉多少。`,
      };
    }
    return {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      errorCode: null,
      spokenPrompt: reminderConfirmationPrompt(
        scheduled.toISOString(),
        foodText ?? (item ? reminderFoodText(item) : '处理这件事'),
      ),
    };
  }

  private async resolveRelativeReminderText(
    householdId: string,
    userId: string,
    foodId: string,
    foodName: string,
    fraction: string,
  ): Promise<string | null> {
    const inventory = await this.queries.getInventoryView(householdId, userId);
    const matching = inventory.zones
      .flatMap((zone) => zone.items)
      .filter((item) => item.food_id === foodId);
    const units = new Set(matching.map((item) => item.unit));
    if (matching.length === 0 || units.size !== 1) return null;
    const quantity = matching
      .reduce((total, item) => total.plus(item.total_quantity), new Big(0))
      .times(fraction);
    const unit = matching[0]?.unit;
    if (!unit || quantity.lte(0)) return null;
    return `吃掉${quantity.toString()}${unitSpokenLabel(unit)}${foodName}`;
  }

  private async buildInventoryQueryPrompt(
    householdId: string,
    userId: string,
    normalized: string,
    parsed: ParseResult,
    options: { taskId?: string | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<string> {
    const recipe = await this.meals.findSuggestedRecipeForVoiceRequest(
      householdId,
      userId,
      normalized,
    );
    if (recipe) {
      if (recipe.missing.length === 0)
        return `做${recipe.name}需要的食材你都有了：${recipe.ingredients
          .filter((item) => !item.optional)
          .map(
            (item) =>
              `${item.food_name}${item.quantity ?? ''}${item.unit_code ? unitSpokenLabel(item.unit_code) : ''}`,
          )
          .join('、')}。这是库存核对，不会自动扣减。`;
      const missing = recipe.missing.map(
        (item) =>
          `${item.food_name}${item.quantity ?? ''}${item.unit_code ? unitSpokenLabel(item.unit_code) : ''}`,
      );
      const available = recipe.ingredients
        .filter((item) => !item.optional && item.available)
        .map((item) => item.food_name);
      return `做${recipe.name}还缺：${missing.join('、')}。${available.length ? `现有${available.join('、')}。` : ''}如果需要，我可以在你明确说“加入购物清单”后再为你创建待购项。`;
    }
    const inventory =
      options.taskId && this.toolExecutor
        ? await this.toolExecutor.execute(
            'inventory.read',
            { taskId: options.taskId, signal: options.signal },
            () => this.queries.getInventoryView(householdId, userId),
          )
        : await this.queries.getInventoryView(householdId, userId);
    const selectedZones = selectInventoryZones(inventory.zones, normalized);
    const requestedZone = selectedZones.length === 1 ? selectedZones[0] : null;
    let items = selectedZones.flatMap((zone) => zone.items);
    const requestedIds = new Set(parsed.items.map((item) => item.food_id));
    if (requestedIds.size > 0) items = items.filter((item) => requestedIds.has(item.food_id));

    const categoryRequest =
      requestedIds.size === 0 ? await this.foodCategories.resolveSpokenQuery(normalized) : null;
    if (categoryRequest) {
      items = items.filter((item) => categoryRequest.descendantCodes.has(item.category_code));
    }

    const asksExpiryDate = /什么时候|哪天/.test(normalized) && /到期|过期/.test(normalized);
    const asksExpiry = asksExpiryDate || /快过期|临期|过期/.test(normalized);
    const asksMealIdea = isMealDecisionRequest(normalized);
    // “什么时候到期”是查询具体日期，不能像“哪些快过期”一样先过滤掉正常批次。
    if (asksExpiry && !asksExpiryDate) {
      items = items.filter(
        (item) => item.expiry_status === 'EXPIRING' || item.expiry_status === 'EXPIRED',
      );
    }

    if (items.length === 0) {
      if (requestedIds.size > 0) {
        const names = parsed.items.map((item) => item.food_name).join('、');
        return requestedZone
          ? `${requestedZone.name}目前没有${names}。`
          : `目前库存里没有${names}。`;
      }
      if (categoryRequest)
        return requestedZone
          ? `${requestedZone.name}目前没有${categoryRequest.label}。`
          : `目前库存里没有${categoryRequest.label}。`;
      if (requestedZone) return `${requestedZone.name}目前是空的。`;
      return asksExpiry ? '目前没有临期或已经过期的食材。' : '目前库存还是空的。';
    }

    if (asksMealIdea) {
      return this.meals.buildVoiceMealRecommendation(
        householdId,
        userId,
        normalized,
        items,
        options,
      );
    }

    const descriptions = items
      .slice(0, 8)
      .map((item) => {
        const quantity = `${item.name}${item.total_quantity}${unitSpokenLabel(item.unit)}`;
        if (!asksExpiry) return quantity;
        if (!item.earliest_expiry) return asksExpiryDate ? `${quantity}（未记录到期日）` : quantity;
        const expiry = new Date(item.earliest_expiry);
        if (!Number.isFinite(expiry.getTime())) return quantity;
        return `${quantity}（${expiry.getFullYear()}年${expiry.getMonth() + 1}月${expiry.getDate()}日到期）`;
      });
    const suffix = items.length > 8 ? `等${items.length}种食材` : '';
    if (asksExpiry)
      return `需要优先处理的有：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
    if (requestedIds.size > 0)
      return requestedZone
        ? `${requestedZone.name}目前有${descriptions.join('、')}。`
        : `目前有${descriptions.join('、')}。`;
    if (categoryRequest)
      return requestedZone
        ? `${requestedZone.name}现在有${categoryRequest.label}：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`
        : `你现在有${categoryRequest.label}：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
    if (requestedZone)
      return `${requestedZone.name}现在有：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
    return `你现在有：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
  }

  async getJob(jobId: string, userId: string) {
    const result = await this.pool.query<VoiceJobRow>(
      `select ${JOB_COLUMNS} from voice_jobs where id = $1`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) throw new DomainError('NOT_FOUND', 'VOICE_JOB_NOT_FOUND', 'Voice job not found.');
    await this.membership.assertMembership(job.household_id, userId);
    return this.presentJob(job);
  }

  private presentJob(job: VoiceJobRow) {
    return {
      voice_job_id: job.id,
      household_id: job.household_id,
      status: job.status,
      transcript:
        job.transcript_raw !== null
          ? { raw: job.transcript_raw, normalized: job.transcript_normalized }
          : null,
      candidate_command: job.candidate_command_json,
      confidence: job.confidence_json,
      requires_confirmation: job.requires_confirmation,
      error_code: job.error_code,
      executed_transaction_id: job.executed_transaction_id,
      // 系统要"说出来"的话（前端用 Kokoro TTS 合成）
      spoken_prompt: job.spoken_prompt,
      turn_count: job.turn_count,
      dialogue_turns: job.dialogue_turns,
      session_id: job.session_id,
      turn_id: job.turn_id,
      created_at: job.created_at.toISOString(),
      completed_at: job.completed_at?.toISOString() ?? null,
    };
  }

  /**
   * 按钮确认执行（确认卡片路径）：payload 允许用户改过，重新走完整 Schema 校验。
   * household 从任务本身取，不信任客户端（docs/03 §5.3）；idempotency key 由任务 ID 派生。
   */
  async confirm(jobId: string, userId: string, body: z.infer<typeof ConfirmVoiceJobSchema>) {
    const job = await this.loadJobRow(jobId);
    await this.membership.assertMembership(job.household_id, userId);
    if (job.status !== 'AWAITING_CONFIRMATION') {
      throw new DomainError('CONFLICT', 'VOICE_JOB_NOT_CONFIRMABLE', `Voice job is ${job.status}.`);
    }
    const overridePayload = body.payload ?? undefined;
    const result = await this.executeCandidate(job, userId, overridePayload);
    return { ...result, voice_job_id: jobId };
  }

  /**
   * 语音多轮对话推进：用户对系统播报的口头回应（对/不对/修正）。
   * - AWAITING_CLARIFICATION：期望补数量（"两盒"）-> 填入后转确认
   * - AWAITING_CONFIRMATION ：CONFIRM 执行 / REJECT 取消 / CORRECTION 改后重新确认 / UNCLEAR 追问
   * 全部确定性；执行走同一 Command 管道，库存事实仍由领域层把关（docs/07 §9）。
   */
  async reply(jobId: string, userId: string, input: z.infer<typeof ReplyVoiceJobSchema>) {
    const job = await this.loadJobRow(jobId);
    await this.membership.assertMembership(job.household_id, userId);
    if (!REPLIABLE_STATUSES.has(job.status)) {
      throw new DomainError('CONFLICT', 'VOICE_JOB_NOT_REPLIABLE', `Voice job is ${job.status}.`);
    }
    if (input.turn_id) {
      await this.pool.query(`update voice_jobs set turn_id=$2 where id=$1`, [
        job.id,
        input.turn_id,
      ]);
    }
    const originalRequest =
      job.transcript_raw?.trim() ?? job.dialogue_turns.find((turn) => turn.role === 'user')?.text ?? '';
    const combinedMealRequest = `${originalRequest}，${input.text}`;
    // 用户在未完成的库存槽位里说“我不知道，你推荐/你来安排”时，
    // 这不是数量不清楚，而是主动把任务切换为餐食决策；清掉旧候选，保留原场景上下文。
    if (
      job.candidate_command_json?.command_type !== 'MEAL_RECOMMENDATION' &&
      isRecommendationModeSwitch(input.text) &&
      isMealDecisionRequest(combinedMealRequest)
    ) {
      return this.replaceWithMealRecommendation(job, userId, combinedMealRequest, input.turn_id);
    }
    if (job.candidate_command_json?.command_type === 'MEAL_RECOMMENDATION') {
      return this.advanceMealContext(job, userId, input.text, input.turn_id);
    }
    const catalog = await this.loadCatalog(job.household_id);
    const replacement = parseTranscript(normalizeTranscript(input.text), catalog);
    if (READ_ONLY_QUERY_INTENTS.has(replacement.intent)) {
      await this.pool.query(
        `update voice_jobs set status='CANCELLED',completed_at=now() where id=$1`,
        [job.id],
      );
      return this.createTextJob(userId, {
        household_id: job.household_id,
        transcript_text: input.text,
        locale: 'zh',
        channel: ChannelSchema.parse(job.source_channel),
      });
    }
    const turns = [
      ...job.dialogue_turns,
      { role: 'user' as const, text: input.text, at: nowIso() },
    ];

    if (
      job.candidate_command_json?.command_type === 'CREATE_REMINDER' ||
      job.candidate_command_json?.command_type === 'UPDATE_REMINDER'
    ) {
      return this.advanceReminder(job, userId, input.text, catalog, turns);
    }

    if (job.status === 'AWAITING_CLARIFICATION') {
      return this.advanceClarification(job, userId, input.text, catalog, turns);
    }
    return this.advanceConfirmation(job, userId, input.text, catalog, turns);
  }

  private async advanceMealContext(
    job: VoiceJobRow,
    userId: string,
    replyText: string,
    turnId?: string,
  ) {
    const original = job.candidate_command_json?.payload?.request_text?.trim();
    if (!original) {
      throw new DomainError('CONFLICT', 'VOICE_JOB_INVALID_CANDIDATE', '餐食上下文缺少原始请求。');
    }
    const combined = `${original}，${replyText}`;
    const clarification = await this.meals.getMealContextClarification(
      job.household_id,
      userId,
      combined,
    );
    if (clarification) {
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate: job.candidate_command_json,
        spokenPrompt: clarification,
        turns: [
          ...job.dialogue_turns,
          { role: 'user' as const, text: replyText, at: nowIso() },
        ],
        userId,
      });
    }
    return this.replaceWithMealRecommendation(job, userId, combined, turnId);
  }

  private async replaceWithMealRecommendation(
    job: VoiceJobRow,
    userId: string,
    requestText: string,
    turnId?: string,
  ) {
    await this.pool.query(
      `update voice_jobs
          set status='CANCELLED', completed_at=now(), error_code='MEAL_CONTEXT_REPLACED'
        where id=$1`,
      [job.id],
    );
    this.coordinator?.cancel(job.id);
    const payload = {
      household_id: job.household_id,
      transcript_text: requestText,
      locale: 'zh',
      channel: ChannelSchema.parse(job.source_channel),
      ...(job.session_id ? { session_id: job.session_id } : {}),
      ...(turnId ? { turn_id: turnId } : {}),
    } satisfies z.infer<typeof CreateTextVoiceJobSchema>;
    return this.createTextJob(userId, payload);
  }

  private async advanceReminder(
    job: VoiceJobRow,
    userId: string,
    replyText: string,
    catalog: FoodCatalogEntry[],
    turns: DialogueTurn[],
  ) {
    const candidate = job.candidate_command_json;
    const payload = candidate?.payload ?? {};
    const interp = interpretReply(replyText, catalog);
    const relativeFraction = relativeInventoryFraction(replyText);

    if (interp.kind === 'REJECT') {
      turns.push({ role: 'system', text: CANCELLED_PROMPT, at: nowIso() });
      await this.pool.query(
        `update voice_jobs set status='CANCELLED',spoken_prompt=$2,turn_count=turn_count+1,dialogue_turns=$3,completed_at=now() where id=$1`,
        [job.id, CANCELLED_PROMPT, JSON.stringify(turns)],
      );
      return this.getJob(job.id, userId);
    }

    if (
      !relativeFraction &&
      interp.kind === 'CONFIRM' &&
      payload.reminder_text &&
      payload.scheduled_for
    ) {
      await this.executeCandidate(job, userId, undefined, turns);
      return this.getJob(job.id, userId);
    }

    if (interp.kind !== 'CONFIRM' || relativeFraction) {
      const normalizedReply = normalizeReminderSpeech(replyText);
      const scheduled = parseReminderSchedule(normalizedReply);
      if (scheduled) payload.scheduled_for = scheduled.toISOString();

      const parsed = parseTranscript(normalizeTranscript(normalizedReply), catalog);
      const item = parsed.items[0];
      const purchaseReminder = /买|购买|采购|补充|添置/.test(normalizedReply);
      if (item) {
        payload.food_id = item.food_id;
        payload.food_name = item.food_name;
        payload.reminder_text = purchaseReminder
          ? (extractReminderText(normalizedReply) ?? reminderFoodText(item))
          : reminderFoodText(item);
      } else {
        const genericText = extractReminderText(normalizedReply);
        if (genericText) payload.reminder_text = genericText;
      }
      if (relativeFraction && payload.food_id && payload.food_name) {
        const relativeText = await this.resolveRelativeReminderText(
          job.household_id,
          userId,
          payload.food_id,
          payload.food_name,
          relativeFraction,
        );
        if (!relativeText) {
          return this.persistTurn(job, {
            status: 'AWAITING_CLARIFICATION',
            candidate,
            spokenPrompt: `我暂时无法按当前库存换算${payload.food_name}的一半。请告诉我要提醒你吃掉多少。`,
            turns,
            userId,
          });
        }
        payload.reminder_text = relativeText;
      }
    }

    if (!payload.scheduled_for) {
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: '你希望我在什么时候提醒？',
        turns,
        userId,
      });
    }
    if (!payload.reminder_text) {
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: '你想让我提醒你做什么？例如“明天买绿叶菜”或“明天吃药”。',
        turns,
        userId,
      });
    }

    return this.persistTurn(job, {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      spokenPrompt: reminderConfirmationPrompt(payload.scheduled_for, payload.reminder_text),
      turns,
      userId,
    });
  }

  private async advanceClarification(
    job: VoiceJobRow,
    userId: string,
    replyText: string,
    catalog: FoodCatalogEntry[],
    turns: DialogueTurn[],
  ) {
    const candidate = job.candidate_command_json;
    const items = candidate?.payload?.items ?? [];
    const interp = interpretReply(replyText, catalog);
    const normalizedReply = normalizeTranscript(replyText);

    if (interp.kind === 'REJECT') {
      turns.push({ role: 'system', text: CANCELLED_PROMPT, at: nowIso() });
      await this.pool.query(
        `update voice_jobs
         set status = 'CANCELLED', spoken_prompt = $2, turn_count = turn_count + 1,
             dialogue_turns = $3, completed_at = now()
         where id = $1`,
        [job.id, CANCELLED_PROMPT, JSON.stringify(turns)],
      );
      return this.getJob(job.id, userId);
    }

    // 针对 ADD_INVENTORY 连续报菜名与暂存箱模式
    if (candidate?.command_type === 'ADD_INVENTORY') {
      const isCommit = BATCH_COMMIT_PATTERN.test(normalizedReply);
      const parsedReply = parseTranscript(normalizedReply, catalog);

      if (isCommit && items.length > 0) {
        const spokenList = toSpokenItems(items);
        const itemNames = spokenList
          .map((i) => `${i.food_name}${i.quantity}${unitSpokenLabel(i.unit)}`)
          .join('、');
        const prompt = `已为你整理好，准备入库 ${items.length} 样食材：${itemNames}。确认入库吗？`;
        return this.persistTurn(job, {
          status: 'AWAITING_CONFIRMATION',
          candidate,
          spokenPrompt: prompt,
          turns,
          userId,
        });
      }

      if (parsedReply.items.length > 0) {
        const newCandidateItems = parsedReply.items.map(toCandidateItem);
        items.push(...newCandidateItems);
        if (candidate.payload) {
          candidate.payload.items = items;
        }

        const newSpoken = parsedReply.items
          .map(
            (i) => `${i.food_name}${i.quantity_explicit ? i.quantity : '1'}${unitSpokenLabel(i.unit)}`,
          )
          .join('、');
        const prompt = `已记下：${newSpoken}（当前共 ${items.length} 样）。可以继续报下一个，或者说‘就这些’完成录入。`;
        return this.persistTurn(job, {
          status: 'AWAITING_CLARIFICATION',
          candidate,
          spokenPrompt: prompt,
          turns,
          userId,
        });
      }

      // 如果未产生新食材，且连续追问超过 2 轮（避免“请问要添加多少这个？”复读死循环）
      const userTurns = turns.filter((t) => t.role === 'user').length;
      if (items.length === 0 && userTurns >= 3) {
        const fallbackPrompt =
          '抱歉没有听清具体的食材和数量。您可以重新说出食材（如‘加两盒牛奶’），或者直接在屏幕上手动添加。';
        turns.push({ role: 'system', text: fallbackPrompt, at: nowIso() });
        await this.pool.query(
          `update voice_jobs set status='FAILED', spoken_prompt=$2, turn_count=turn_count+1, dialogue_turns=$3, completed_at=now(), error_code='CLARIFICATION_LOOP_PREVENTED' where id=$1`,
          [job.id, fallbackPrompt, JSON.stringify(turns)],
        );
        return this.getJob(job.id, userId);
      }
    }

    let filled = false;
    let relativePrompt = '';
    const relativeFraction = relativeInventoryFraction(replyText);
    if (
      relativeFraction &&
      items.length === 1 &&
      items[0] &&
      (candidate?.command_type === 'CONSUME_INVENTORY' ||
        candidate?.command_type === 'DISCARD_INVENTORY')
    ) {
      const inventory = await this.queries.getInventoryView(job.household_id, userId);
      const matching = inventory.zones
        .flatMap((zone) => zone.items)
        .filter((item) => item.food_id === items[0]?.food_id);
      const units = new Set(matching.map((item) => item.unit));
      if (matching.length > 0 && units.size === 1) {
        const quantity = matching
          .reduce((total, item) => total.plus(item.total_quantity), new Big(0))
          .times(relativeFraction);
        items[0].quantity = quantity.toString();
        items[0].unit = matching[0]?.unit ?? items[0].unit;
        relativePrompt = `按当前库存计算，一半是${items[0].quantity}${unitSpokenLabel(items[0].unit)}。`;
        filled = true;
      }
    }

    if (!filled && interp.kind === 'CORRECTION') {
      if (interp.hasFood && interp.items[0]) {
        // 用户直接补了“两个苹果”。若上轮只缺食材，先把完整候选补齐。
        const first = interp.items[0];
        if (!items.length) {
          items.push(...interp.items.map(toCandidateItem));
          filled = interp.items.every((item) => item.quantity_explicit);
        } else if (items[0]) {
          items[0].quantity = first.quantity;
          items[0].unit = first.unit;
          filled = true;
        }
      } else if (interp.bareQuantity && items[0]) {
        items[0].quantity = interp.bareQuantity.quantity;
        items[0].unit = interp.bareQuantity.unit;
        filled = true;
      }
    }

    await this.applyRequestedStorageZone(
      job.household_id,
      normalizeTranscript(replyText),
      candidate,
    );

    if (!filled || !candidate?.command_type) {
      // 没听清数量，继续追问
      const food = catalog.find((entry) => entry.id === items[0]?.food_id);
      const prompt = clarifyQuantityPrompt(
        candidate?.command_type ?? 'ADD_INVENTORY',
        items[0]?.display_text ?? '这个',
        food ? suggestedUnitsForFood(food) : [],
      );
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: prompt,
        turns,
        userId,
      });
    }

    const correctedItem = items[0];
    const correctedFood = catalog.find((entry) => entry.id === correctedItem?.food_id);
    if (
      correctedItem &&
      correctedFood &&
      !isReasonableUnitForFood(correctedFood, correctedItem.unit)
    ) {
      const prompt = clarifyUnitPrompt(
        correctedItem.display_text ?? correctedFood.canonicalName,
        correctedItem.quantity,
        correctedItem.unit,
        suggestedUnitsForFood(correctedFood),
      );
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: prompt,
        turns,
        userId,
      });
    }

    const prompt = `${relativePrompt}${confirmPrompt(candidate.command_type, toSpokenItems(items))}`;
    return this.persistTurn(job, {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      spokenPrompt: prompt,
      turns,
      userId,
    });
  }

  private async advanceConfirmation(
    job: VoiceJobRow,
    userId: string,
    replyText: string,
    catalog: FoodCatalogEntry[],
    turns: DialogueTurn[],
  ) {
    const candidate = job.candidate_command_json;
    const interp = interpretReply(replyText, catalog);

    await this.applyRequestedStorageZone(
      job.household_id,
      normalizeTranscript(replyText),
      candidate,
    );

    if (interp.kind === 'REJECT') {
      turns.push({ role: 'system', text: CANCELLED_PROMPT, at: nowIso() });
      await this.pool.query(
        `update voice_jobs
         set status = 'CANCELLED', spoken_prompt = $2, turn_count = turn_count + 1,
             dialogue_turns = $3, completed_at = now()
         where id = $1`,
        [job.id, CANCELLED_PROMPT, JSON.stringify(turns)],
      );
      return this.getJob(job.id, userId);
    }

    if (interp.kind === 'CONFIRM') {
      // 执行后返回"呈现后的任务"（含 status=COMPLETED、spoken_prompt、executed_transaction_id），
      // 供前端对话循环判断终态并播报"好的，已添加。"
      await this.executeCandidate(job, userId, undefined, turns);
      return this.getJob(job.id, userId);
    }

    if (interp.kind === 'CORRECTION' && candidate?.command_type) {
      const applied = applyCorrection(candidate, interp);
      if (applied) {
        const prompt = correctedPrompt(
          candidate.command_type,
          toSpokenItems(candidate.payload?.items ?? []),
        );
        return this.persistTurn(job, {
          status: 'AWAITING_CONFIRMATION',
          candidate,
          spokenPrompt: prompt,
          turns,
          userId,
        });
      }
    }

    // UNCLEAR 或无法应用的修正：追问
    return this.persistTurn(job, {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      spokenPrompt: UNCLEAR_PROMPT,
      turns,
      userId,
    });
  }

  private async persistTurn(
    job: VoiceJobRow,
    opts: {
      status: string;
      candidate: VoiceJobRow['candidate_command_json'];
      spokenPrompt: string;
      turns: DialogueTurn[];
      userId: string;
    },
  ) {
    const turns = [
      ...opts.turns,
      { role: 'system' as const, text: opts.spokenPrompt, at: nowIso() },
    ];
    await this.pool.query(
      `update voice_jobs
       set status = $2, candidate_command_json = $3, spoken_prompt = $4,
           turn_count = turn_count + 1, dialogue_turns = $5
       where id = $1`,
      [
        job.id,
        opts.status,
        opts.candidate ? JSON.stringify(opts.candidate) : null,
        opts.spokenPrompt,
        JSON.stringify(turns),
      ],
    );
    return this.getJob(job.id, opts.userId);
  }

  /** 执行候选命令并把任务标记完成；确认按钮与语音"对"共用。 */
  private async executeCandidate(
    job: VoiceJobRow,
    userId: string,
    overridePayload: unknown,
    turns?: DialogueTurn[],
  ) {
    const rawCommandType = job.candidate_command_json?.command_type;
    if (rawCommandType === 'ADD_SHOPPING_ITEM') {
      const item = job.candidate_command_json?.payload?.items?.[0];
      if (!item) {
        throw new DomainError('CONFLICT', 'VOICE_JOB_INVALID_CANDIDATE', '购物清单候选缺少食材。');
      }
      const runShoppingConfirm = () =>
        this.meals.addShoppingItem(job.household_id, userId, {
          food_id: item.food_id,
          ...(item.quantity_explicit ? { quantity: item.quantity, unit_code: item.unit } : {}),
          source: 'VOICE',
          idempotency_key: `voice-${job.id}`,
        });
      const result = this.toolExecutor
        ? await this.toolExecutor.execute(
            'shopping.confirm',
            { taskId: job.id },
            runShoppingConfirm,
          )
        : await runShoppingConfirm();
      const spoken = '好的，已经加入购物清单。这里只记录待购事项，不会自动下单。';
      const finalTurns = turns
        ? [...turns, { role: 'system' as const, text: spoken, at: nowIso() }]
        : null;
      await this.pool.query(
        `update voice_jobs set status='COMPLETED',completed_at=now(),spoken_prompt=$2,dialogue_turns=coalesce($3,dialogue_turns),turn_count=turn_count+case when $3 is null then 0 else 1 end where id=$1`,
        [job.id, spoken, finalTurns ? JSON.stringify(finalTurns) : null],
      );
      void this.runtime?.recordEvent({
        householdId: job.household_id,
        sessionId: job.session_id,
        turnId: job.turn_id,
        taskId: job.id,
        eventType: 'SHOPPING_CONFIRMED',
        intent: 'ADD_SHOPPING_ITEM',
        outcome: 'completed',
      });
      this.coordinator?.complete(job.id, 'COMPLETED');
      return result;
    }
    if (rawCommandType === 'CREATE_REMINDER' || rawCommandType === 'UPDATE_REMINDER') {
      const payload = job.candidate_command_json?.payload;
      if (!payload?.reminder_text || !payload.scheduled_for)
        throw new DomainError(
          'CONFLICT',
          'VOICE_JOB_INVALID_CANDIDATE',
          '提醒候选缺少时间或内容。',
        );
      const reminder =
        rawCommandType === 'UPDATE_REMINDER' && payload.reminder_id
          ? await this.notifications.updateReminder(job.household_id, payload.reminder_id, userId, {
              ...(payload.food_id ? { food_id: payload.food_id } : {}),
              reminder_text: payload.reminder_text,
              scheduled_for: payload.scheduled_for,
            })
          : await this.notifications.createReminder(job.household_id, userId, {
              ...(payload.food_id ? { food_id: payload.food_id } : {}),
              reminder_text: payload.reminder_text,
              scheduled_for: payload.scheduled_for,
              idempotency_key: `voice-${job.id}`,
              source_channel: job.source_channel,
            });
      const spoken =
        rawCommandType === 'UPDATE_REMINDER'
          ? '好的，原来的提醒已经修改。到点后我会提醒你，库存不会自动扣减。'
          : '好的，提醒已经设置。到点后我会提醒你，库存不会自动扣减。';
      const finalTurns = turns
        ? [...turns, { role: 'system' as const, text: spoken, at: nowIso() }]
        : null;
      await this.pool.query(
        `update voice_jobs set status='COMPLETED',completed_at=now(),spoken_prompt=$2,dialogue_turns=coalesce($3,dialogue_turns),turn_count=turn_count+case when $3 is null then 0 else 1 end where id=$1`,
        [job.id, spoken, finalTurns ? JSON.stringify(finalTurns) : null],
      );
      return reminder;
    }
    const commandType = rawCommandType as keyof typeof COMMAND_PAYLOAD_SCHEMAS | undefined;
    if (!commandType || !(commandType in COMMAND_PAYLOAD_SCHEMAS)) {
      throw new DomainError('CONFLICT', 'VOICE_JOB_INVALID_CANDIDATE', 'No executable candidate.');
    }
    const payload = overridePayload ?? job.candidate_command_json?.payload;

    const result = await this.commands.execute(
      {
        command_type: commandType,
        schema_version: '1.0',
        household_id: job.household_id,
        source: {
          channel: ChannelSchema.parse(job.source_channel),
          client: 'voice',
          interaction_id: job.id,
        },
        idempotency_key: `voice-${job.id}`,
        payload,
      },
      userId,
    );

    const spoken = executedPrompt(commandType);
    const finalTurns = turns
      ? [...turns, { role: 'system' as const, text: spoken, at: nowIso() }]
      : null;
    await this.pool.query(
      `update voice_jobs
       set status = 'COMPLETED', executed_transaction_id = $2, completed_at = now(),
           spoken_prompt = $3,
           dialogue_turns = coalesce($4, dialogue_turns),
           turn_count = turn_count + case when $4 is null then 0 else 1 end
       where id = $1`,
      [job.id, result.transaction_id, spoken, finalTurns ? JSON.stringify(finalTurns) : null],
    );
    return result;
  }

  async cancel(jobId: string, userId: string) {
    const job = await this.loadJobRow(jobId);
    await this.membership.assertMembership(job.household_id, userId);
    if (job.status === 'COMPLETED') {
      throw new DomainError('CONFLICT', 'VOICE_JOB_ALREADY_EXECUTED', 'Job already executed.');
    }
    await this.pool.query(
      `update voice_jobs
          set status = 'CANCELLED', cancel_requested_at = now(), completed_at = now()
        where id = $1 and status not in ('COMPLETED','CANCELLED')`,
      [jobId],
    );
    void this.runtime?.recordEvent({
      householdId: job.household_id,
      sessionId: job.session_id,
      turnId: job.turn_id,
      taskId: job.id,
      eventType: 'TASK_CANCELLED',
      outcome: 'cancelled',
    });
    this.coordinator?.cancel(job.id);
    return { voice_job_id: jobId, status: 'CANCELLED' };
  }

  async recordMealFeedback(
    jobId: string,
    userId: string,
    input: z.infer<typeof MealFeedbackSchema>,
  ) {
    const job = await this.loadJobRow(jobId);
    await this.membership.assertMembership(job.household_id, userId);
    if (job.status !== 'COMPLETED') {
      throw new DomainError(
        'CONFLICT',
        'MEAL_PLAN_NOT_COMPLETE',
        '餐食方案尚未完成，暂时不能记录反馈。',
      );
    }
    if (!job.transcript_normalized || !isMealDecisionRequest(job.transcript_normalized)) {
      throw new DomainError(
        'CONFLICT',
        'NOT_MEAL_PLAN',
        '这条任务不是餐食方案，不能记录餐食反馈。',
      );
    }
    const eventType =
      input.outcome === 'ACCEPTED'
        ? 'MEAL_PLAN_ACCEPTED'
        : input.outcome === 'MODIFIED'
          ? 'MEAL_PLAN_MODIFIED'
          : 'MEAL_PLAN_REJECTED';
    await this.runtime?.recordEvent({
      householdId: job.household_id,
      sessionId: job.session_id,
      turnId: job.turn_id,
      taskId: job.id,
      eventType,
      intent: 'MEAL_RECOMMENDATION',
      outcome: input.outcome.toLowerCase(),
      metadata: {
        step: 'meal_feedback',
        ...(input.note ? { note: input.note } : {}),
      },
    });
    return { voice_job_id: job.id, outcome: input.outcome };
  }

  private async loadJobRow(jobId: string): Promise<VoiceJobRow> {
    const result = await this.pool.query<VoiceJobRow>(
      `select ${JOB_COLUMNS} from voice_jobs where id = $1 for update`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) throw new DomainError('NOT_FOUND', 'VOICE_JOB_NOT_FOUND', 'Voice job not found.');
    return job;
  }

  private async loadCatalog(householdId: string): Promise<FoodCatalogEntry[]> {
    const result = await this.pool.query<{
      id: string;
      canonical_name: string;
      category: string;
      default_unit_code: string;
      preferred_unit_codes: string[];
      aliases: string[];
    }>(
      `select fc.id, fc.canonical_name, fc.category, fc.default_unit_code,
              fc.preferred_unit_codes,
              coalesce(array_agg(fa.alias) filter (where fa.alias is not null), '{}') as aliases
       from food_catalog fc
       left join food_aliases fa on fa.food_id = fc.id
       where fc.household_id is null or fc.household_id = $1
       group by fc.id`,
      [householdId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      canonicalName: row.canonical_name,
      category: row.category,
      defaultUnitCode: row.default_unit_code,
      preferredUnitCodes: row.preferred_unit_codes,
      aliases: row.aliases,
    }));
  }

  private async applyRequestedStorageZone(
    householdId: string,
    normalized: string,
    candidate: VoiceJobRow['candidate_command_json'],
  ): Promise<void> {
    if (candidate?.command_type !== 'ADD_INVENTORY' || !candidate.payload?.items?.length) return;
    const code = requestedStorageZoneCode(normalized);
    if (!code) return;
    const result = await this.pool.query<{ id: string }>(
      `select id from storage_zones where household_id=$1 and code=$2 limit 1`,
      [householdId, code],
    );
    const zoneId = result.rows[0]?.id;
    if (!zoneId) return;
    for (const item of candidate.payload.items) item.storage_zone_id = zoneId;
  }
}

export function selectInventoryZones(
  zones: InventoryZoneView[],
  normalized: string,
): InventoryZoneView[] {
  const requestedCode = /冷冻(?:室|区|层|柜)?/.test(normalized)
    ? 'FREEZER'
    : /冷藏(?:室|区|层|柜)?/.test(normalized)
      ? 'FRIDGE'
      : /常温(?:区|室|柜)?/.test(normalized)
        ? 'PANTRY'
        : null;
  return requestedCode ? zones.filter((zone) => zone.code === requestedCode) : zones;
}

/** 只有确实需要组合、权衡和个性化的餐食请求才进入大模型 Agent。 */
export function isMealDecisionRequest(normalized: string): boolean {
  return /(?:今天|明天|后天|今晚|中午|晚上|下午|早上).*(?:吃什么|做什么菜|做点什么|推荐|搭配|菜单|餐食|菜品)|(?:推荐|搭配|安排|菜单).*(?:今天|明天|后天|今晚|中午|晚上|下午|早上).*(?:菜|餐|食谱|吃)|(?:早餐|早饭|午餐|中饭|晚餐|晚饭|夜宵|宵夜|家庭餐|家庭晚餐|全家|一个人|多人|几个人|聚会|一起吃).*(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|菜单|餐食|菜品|简单|快手|食谱|菜谱|几道菜|吃|用餐|安排|准备)|(?:明天|后天|今天|今晚|早上|中午|晚上)?(?:早餐|早饭|午餐|中饭|晚餐|晚饭|下午茶|加餐|夜宵|宵夜|家庭餐|家庭晚餐|聚会).{0,24}(?:吃|用餐|两个人|三个人|四个人|五个人|六个人|[一二两三四五六七八九十\d]+(?:个)?(?:人|位|口)|安排|准备)|(?:下午茶|加餐|小点心|点心|零食).*(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|简单|食谱|菜谱)|(?:想吃|想要吃|吃什么|做什么).{0,30}(?:你来推荐|帮我推荐|你推荐|推荐一下|你安排|随便安排|帮我选)|(?:能做|可以做|吃什么|怎么吃|美食|菜谱|食谱|减脂餐|菜单|餐食|菜品)|(?:这个)?(?:搭配|菜单|方案).*(?:不合理|不够|调整|修改)|(?:不合理|不够).*(?:调味料|食材|吃|人份|菜|餐|搭配)|(?:减脂|减肥|少油|少盐|清淡|低脂).*(?:餐|菜|食谱|搭配|做法)?/.test(
    normalized,
  );
}

/** 用户明确放弃自己选择、要求小知接管推荐时的模式切换信号。 */
export function isRecommendationModeSwitch(normalized: string): boolean {
  return /我(?:也)?不知道|你来(?:帮我)?推荐|你推荐(?:一下)?|推荐一下|你来安排|随便(?:你|安排)?|你决定|帮我选|不用我决定/.test(
    normalized.replace(/[\s，。！？、,.!?：:；;]/g, ''),
  );
}

export function reminderQueryPrompt(
  tasks: Array<{ reminder_text: string; scheduled_for: Date | string }>,
  normalized: string,
  requestedTimezone: string,
  now = new Date(),
): string {
  const timezone = validTimezone(requestedTimezone);
  const day = /后天/.test(normalized)
    ? { offset: 2, label: '后天' }
    : /明天/.test(normalized)
      ? { offset: 1, label: '明天' }
      : /今天|今晚/.test(normalized)
        ? { offset: 0, label: '今天' }
        : null;
  const targetDateKey = day
    ? localDateKey(new Date(now.getTime() + day.offset * 86_400_000), timezone)
    : null;
  const selected = tasks
    .map((task) => ({ ...task, scheduledDate: new Date(task.scheduled_for) }))
    .filter((task) => Number.isFinite(task.scheduledDate.getTime()))
    .filter(
      (task) =>
        targetDateKey === null || localDateKey(task.scheduledDate, timezone) === targetDateKey,
    )
    .sort((left, right) => left.scheduledDate.getTime() - right.scheduledDate.getTime());
  const label = day?.label ?? '接下来';
  if (selected.length === 0) return `${label}没有已设置的提醒安排。`;
  const descriptions = selected.slice(0, 6).map((task) => {
    const time = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(task.scheduledDate);
    return `${time}${task.reminder_text}`;
  });
  const suffix = selected.length > 6 ? `，另外还有${selected.length - 6}项` : '';
  return `${label}的提醒安排是：${descriptions.join('；')}${suffix}。这些提醒不会自动扣减库存。`;
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Asia/Shanghai';
  }
}

function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nowIso(): string {
  return new Date().toISOString();
}

function reminderFoodText(item: {
  food_name: string;
  quantity: string;
  unit: string;
  quantity_explicit: boolean;
}): string {
  if (item.quantity_explicit) {
    return `吃掉${item.quantity}${unitSpokenLabel(item.unit)}${item.food_name}`;
  }
  return `把${item.food_name}吃完`;
}

/** 从提醒语句中提取不一定对应标准食材的动作，例如“买绿叶菜”“交水费”。 */
export function extractReminderText(text: string): string | null {
  const normalized = normalizeReminderSpeech(text)
    .replace(/[，。！？,.!?；;]+/g, ' ')
    .trim();
  const purchase = normalized.match(/(?:买|购买|采购|补充|添置)(?:一些|一点|几样)?\s*(.+)$/);
  if (purchase?.[1]) return `买${purchase[1].replace(/吧|呢|吗$/g, '').trim()}`;
  const generic = normalized.match(/(?:提醒(?:一下)?我?|定(?:一个|个)?提醒(?:吧)?|记得)(.+)$/);
  if (!generic?.[1]) return null;
  const subject = generic[1]
    .replace(/^(?:今天|明天|后天)(?:上午|中午|下午|晚上|早上)?(?:\d{1,2}点)?/, '')
    .trim();
  return subject ? subject.replace(/吧|呢|吗$/g, '').trim() : null;
}

function reminderConfirmationPrompt(scheduledFor: string, reminderText: string): string {
  const label = new Date(scheduledFor).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `你是说，${label}提醒你${reminderText}，对吗？`;
}

function toCandidateItem(item: {
  food_id: string;
  food_name: string;
  quantity: string;
  unit: string;
  quantity_explicit?: boolean;
}): CandidateItem {
  return {
    food_id: item.food_id,
    display_text: item.food_name,
    quantity: item.quantity,
    unit: item.unit,
    ...(item.quantity_explicit === undefined ? {} : { quantity_explicit: item.quantity_explicit }),
  };
}

function buildPayload(
  commandType: string,
  items: CandidateItem[],
): { items: CandidateItem[]; purpose?: string; reason?: string } {
  if (commandType === 'CONSUME_INVENTORY') return { items, purpose: 'UNKNOWN' };
  if (commandType === 'DISCARD_INVENTORY') return { items, reason: 'OTHER' };
  return { items };
}

function toSpokenItems(items: CandidateItem[]): SpokenItem[] {
  return items.map((item) => ({
    food_name: item.display_text ?? '食材',
    quantity: item.quantity,
    unit: item.unit,
  }));
}

/**
 * 把修正应用到候选命令的 items（原地）。返回是否成功。
 * - 带食材的修正：按 food_id 匹配替换，不存在则追加；
 * - 裸数量修正：仅当候选只有一个 item 时更新其数量（多 item 需指明食材，返回 false 触发追问）。
 */
function applyCorrection(
  candidate: NonNullable<VoiceJobRow['candidate_command_json']>,
  interp: {
    hasFood: boolean;
    items: {
      food_id: string;
      food_name: string;
      quantity: string;
      unit: string;
      quantity_explicit?: boolean;
    }[];
    bareQuantity: { quantity: string; unit: string } | null;
  },
): boolean {
  const items = candidate.payload?.items;
  if (!items) return false;

  if (interp.hasFood) {
    for (const ci of interp.items) {
      const existing = items.find((i) => i.food_id === ci.food_id);
      if (existing) {
        existing.quantity = ci.quantity;
        existing.unit = ci.unit;
      } else if (items.length === 1 && interp.items.length === 1 && items[0]) {
        // 对单项候选说“不是鸡蛋，是鸭蛋”属于替换，不应同时保留鸡蛋和鸭蛋。
        const previous = items[0];
        items[0] = {
          food_id: ci.food_id,
          display_text: ci.food_name,
          quantity: ci.quantity_explicit === false ? previous.quantity : ci.quantity,
          unit: ci.quantity_explicit === false ? previous.unit : ci.unit,
          ...(ci.quantity_explicit === undefined
            ? {}
            : { quantity_explicit: ci.quantity_explicit }),
        };
      } else {
        items.push({
          food_id: ci.food_id,
          display_text: ci.food_name,
          quantity: ci.quantity,
          unit: ci.unit,
          ...(ci.quantity_explicit === undefined
            ? {}
            : { quantity_explicit: ci.quantity_explicit }),
        });
      }
    }
    return true;
  }

  if (interp.bareQuantity && items.length === 1 && items[0]) {
    items[0].quantity = interp.bareQuantity.quantity;
    items[0].unit = interp.bareQuantity.unit;
    return true;
  }
  return false;
}
