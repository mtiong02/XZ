import { Inject, Injectable } from '@nestjs/common';
import Big from 'big.js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ChannelSchema, COMMAND_PAYLOAD_SCHEMAS } from '@xz/contracts';
import { PG_POOL } from '../../infra/db/database.module';
import { FoodCategoryService } from '../food-knowledge/food-category.service';
import { MembershipService } from '../household/membership.service';
import { InventoryCommandService } from '../inventory/application/inventory-command.service';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';
import { DomainError } from '../inventory/domain/errors';
import { MealPlanningService } from '../meal-planning/meal-planning.service';
import { NutritionStructureService } from '../nutrition/nutrition.service';
import {
  NotificationService,
  normalizeReminderSpeech,
  parseReminderSchedule,
} from '../notification/notification.service';
import { normalizeTranscript } from './parser/normalizer';
import {
  isReasonableUnitForFood,
  parseTranscript,
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

export const CreateTextVoiceJobSchema = z.object({
  household_id: z.string().uuid(),
  transcript_text: z.string().min(1).max(200),
  locale: z.string().max(10).default('zh'),
  channel: ChannelSchema.default('WEB_VOICE'),
  client_request_id: z.string().max(100).optional(),
});

export const ConfirmVoiceJobSchema = z.object({
  payload: z.unknown(),
});

export const ReplyVoiceJobSchema = z.object({
  text: z.string().min(1).max(200),
});

export interface CandidateItem {
  food_id: string;
  display_text?: string;
  quantity: string;
  unit: string;
  quantity_explicit?: boolean;
}

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
    payload?: {
      items?: CandidateItem[];
      food_id?: string;
      food_name?: string;
      reminder_text?: string;
      scheduled_for?: string;
      reminder_id?: string;
    };
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
}

const REPLIABLE_STATUSES = new Set(['AWAITING_CONFIRMATION', 'AWAITING_CLARIFICATION']);

const JOB_COLUMNS = `id, household_id, status, transcript_raw, transcript_normalized,
       candidate_command_json, confidence_json, requires_confirmation, error_code,
       source_channel, executed_transaction_id, spoken_prompt, turn_count, dialogue_turns,
       created_at, completed_at`;

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
    @Inject(NutritionStructureService) private readonly nutrition: NutritionStructureService,
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
    const outcome =
      parsed.intent === 'CREATE_REMINDER'
        ? await this.buildReminderOutcome(input.household_id, userId, input.transcript_text, parsed)
        : parsed.intent === 'QUERY_SHOPPING_LIST'
          ? await this.buildShoppingListQueryOutcome(input.household_id, userId)
          : this.buildOutcome(parsed);
    if (parsed.intent === 'QUERY_INVENTORY') {
      outcome.spokenPrompt = await this.buildInventoryQueryPrompt(
        input.household_id,
        userId,
        normalized,
        parsed,
      );
    }
    const firstTurn: DialogueTurn[] = [{ role: 'user', text: input.transcript_text, at: nowIso() }];
    if (outcome.spokenPrompt) {
      firstTurn.push({ role: 'system', text: outcome.spokenPrompt, at: nowIso() });
    }

    const inserted = await this.pool.query<{ id: string }>(
      `insert into voice_jobs
         (household_id, actor_member_id, status, locale, source_channel, input_mode,
          transcript_raw, transcript_normalized, candidate_command_json, confidence_json,
          requires_confirmation, error_code, client_request_id, spoken_prompt, turn_count,
          dialogue_turns)
       values ($1, $2, $3, $4, $5, 'TEXT', $6, $7, $8, $9, $10, $11, $12, $13, 1, $14)
       returning id`,
      [
        input.household_id,
        membership.memberId,
        outcome.status,
        input.locale,
        input.channel,
        input.transcript_text,
        normalized,
        outcome.candidate ? JSON.stringify(outcome.candidate) : null,
        JSON.stringify(parsed.confidence),
        outcome.candidate !== null && outcome.candidate.command_type !== 'QUERY_INVENTORY',
        outcome.errorCode,
        input.client_request_id ?? null,
        outcome.spokenPrompt,
        JSON.stringify(firstTurn),
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('voice job insert returned no row');
    return this.getJob(row.id, userId);
  }

  private buildOutcome(parsed: ParseResult): {
    status: string;
    candidate: { command_type: string; payload: { items?: CandidateItem[] } } | null;
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
    if (!commandType || parsed.items.length === 0) {
      return {
        status: 'FAILED',
        candidate: null,
        errorCode: 'AMBIGUOUS_COMMAND',
        spokenPrompt: UNRECOGNIZED_PROMPT,
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
    const foodText = item ? (relativeFoodText ?? reminderFoodText(item)) : undefined;
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
    if (!item) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: '你想让我提醒你处理哪种食材？',
      };
    }
    if (relativeFraction && !relativeFoodText) {
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: `我暂时无法按当前库存换算${item.food_name}的一半。请告诉我要提醒你吃掉多少。`,
      };
    }
    return {
      status: 'AWAITING_CONFIRMATION',
      candidate,
      errorCode: null,
      spokenPrompt: reminderConfirmationPrompt(
        scheduled.toISOString(),
        foodText ?? reminderFoodText(item),
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
  ): Promise<string> {
    const inventory = await this.queries.getInventoryView(householdId, userId);
    let items = inventory.zones.flatMap((zone) => zone.items);
    const requestedIds = new Set(parsed.items.map((item) => item.food_id));
    if (requestedIds.size > 0) items = items.filter((item) => requestedIds.has(item.food_id));

    const categoryRequest =
      requestedIds.size === 0 ? await this.foodCategories.resolveSpokenQuery(normalized) : null;
    if (categoryRequest) {
      items = items.filter((item) => categoryRequest.descendantCodes.has(item.category_code));
    }

    const asksExpiry = /快过期|临期|过期/.test(normalized);
    const asksMealIdea =
      /(?:今天|今晚|中午).*(?:吃什么|做什么菜|做点什么)|(?:能做|可以做|吃什么|怎么吃|美食|菜谱|减脂餐)|(?:减脂|减肥)/.test(
        normalized,
      );
    if (asksExpiry) {
      items = items.filter(
        (item) => item.expiry_status === 'EXPIRING' || item.expiry_status === 'EXPIRED',
      );
    }

    if (items.length === 0) {
      if (requestedIds.size > 0) {
        const names = parsed.items.map((item) => item.food_name).join('、');
        return `目前库存里没有${names}。`;
      }
      if (categoryRequest) return `目前库存里没有${categoryRequest.label}。`;
      return asksExpiry ? '目前没有临期或已经过期的食材。' : '目前库存还是空的。';
    }

    if (asksMealIdea) {
      const prioritized = [...items].sort((left, right) => {
        const rank = (status: string) => (status === 'EXPIRED' ? 0 : status === 'EXPIRING' ? 1 : 2);
        return rank(left.expiry_status) - rank(right.expiry_status);
      });
      const names = prioritized
        .slice(0, 5)
        .map((item) => item.name)
        .join('、');
      const goalNote = /减脂|减肥/.test(normalized)
        ? '如果目标是控制体重，可以优先采用蒸、煮、炖等少油做法，具体份量仍需结合个人情况。'
        : '可以优先采用蒸、煮、炖等简单做法。';
      const structure = await this.nutrition.householdStructure(householdId, userId);
      const attention = structure.observations
        .filter((observation) => observation.severity === 'ATTENTION')
        .slice(0, 1)
        .map((observation) => `另外，${observation.detail}`)
        .join('');
      return `根据当前库存，可以优先用${names}搭配一餐。${goalNote}${attention}${'这只是基于库存结构的餐食建议，不会自动扣减食材。'}`;
    }

    const descriptions = items
      .slice(0, 8)
      .map((item) => `${item.name}${item.total_quantity}${unitSpokenLabel(item.unit)}`);
    const suffix = items.length > 8 ? `等${items.length}种食材` : '';
    if (asksExpiry)
      return `需要优先处理的有：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
    if (requestedIds.size > 0) return `目前有${descriptions.join('、')}。`;
    if (categoryRequest)
      return `你现在有${categoryRequest.label}：${descriptions.join('、')}${suffix ? `，${suffix}` : ''}。`;
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
    const catalog = await this.loadCatalog(job.household_id);
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
      payload.scheduled_for &&
      payload.food_id
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
      if (item) {
        payload.food_id = item.food_id;
        payload.food_name = item.food_name;
        payload.reminder_text = reminderFoodText(item);
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
    if (!payload.food_id || !payload.reminder_text) {
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: '你想让我提醒你处理哪种食材？',
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
        // 用户直接补了"两盒牛奶"
        const first = interp.items[0];
        if (items[0]) {
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
      const result = await this.meals.addShoppingItem(job.household_id, userId, {
        food_id: item.food_id,
        ...(item.quantity_explicit ? { quantity: item.quantity, unit_code: item.unit } : {}),
        source: 'VOICE',
        idempotency_key: `voice-${job.id}`,
      });
      const spoken = '好的，已经加入购物清单。这里只记录待购事项，不会自动下单。';
      const finalTurns = turns
        ? [...turns, { role: 'system' as const, text: spoken, at: nowIso() }]
        : null;
      await this.pool.query(
        `update voice_jobs set status='COMPLETED',completed_at=now(),spoken_prompt=$2,dialogue_turns=coalesce($3,dialogue_turns),turn_count=turn_count+case when $3 is null then 0 else 1 end where id=$1`,
        [job.id, spoken, finalTurns ? JSON.stringify(finalTurns) : null],
      );
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
      `update voice_jobs set status = 'CANCELLED', completed_at = now() where id = $1`,
      [jobId],
    );
    return { voice_job_id: jobId, status: 'CANCELLED' };
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
    items: { food_id: string; food_name: string; quantity: string; unit: string }[];
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
      } else {
        items.push({
          food_id: ci.food_id,
          display_text: ci.food_name,
          quantity: ci.quantity,
          unit: ci.unit,
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
