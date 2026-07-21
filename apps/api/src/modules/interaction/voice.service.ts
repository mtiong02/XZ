import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ChannelSchema, COMMAND_PAYLOAD_SCHEMAS } from '@xz/contracts';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { InventoryCommandService } from '../inventory/application/inventory-command.service';
import { DomainError } from '../inventory/domain/errors';
import { normalizeTranscript } from './parser/normalizer';
import { parseTranscript, type FoodCatalogEntry, type ParseResult } from './parser/intent-parser';
import { interpretReply } from './dialogue/reply-interpreter';
import {
  CANCELLED_PROMPT,
  clarifyQuantityPrompt,
  confirmPrompt,
  correctedPrompt,
  executedPrompt,
  UNCLEAR_PROMPT,
  UNRECOGNIZED_PROMPT,
  type SpokenItem,
} from './dialogue/prompts';

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
    payload?: { items?: CandidateItem[] };
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
    private readonly membership: MembershipService,
    private readonly commands: InventoryCommandService,
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
    const outcome = this.buildOutcome(parsed);
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
        outcome.candidate !== null,
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
    if (parsed.intent === 'QUERY_INVENTORY') {
      // 查询必须有明确食材主体；否则无法回答（也避免注入式文本因命中"库存"字样而被接受）
      if (parsed.items.length === 0) {
        return {
          status: 'FAILED',
          candidate: null,
          errorCode: 'AMBIGUOUS_COMMAND',
          spokenPrompt: UNRECOGNIZED_PROMPT,
        };
      }
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
    const ambiguous = parsed.items.length === 1 && !parsed.items[0]?.quantity_explicit;
    if (ambiguous) {
      const foodName = items[0]?.display_text ?? '这个';
      return {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        errorCode: null,
        spokenPrompt: clarifyQuantityPrompt(commandType, foodName),
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

    if (job.status === 'AWAITING_CLARIFICATION') {
      return this.advanceClarification(job, userId, input.text, catalog, turns);
    }
    return this.advanceConfirmation(job, userId, input.text, catalog, turns);
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
    if (interp.kind === 'CORRECTION') {
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
      const prompt = clarifyQuantityPrompt(
        candidate?.command_type ?? 'ADD_INVENTORY',
        items[0]?.display_text ?? '这个',
      );
      return this.persistTurn(job, {
        status: 'AWAITING_CLARIFICATION',
        candidate,
        spokenPrompt: prompt,
        turns,
        userId,
      });
    }

    const prompt = confirmPrompt(candidate.command_type, toSpokenItems(items));
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
    const commandType = job.candidate_command_json?.command_type as
      keyof typeof COMMAND_PAYLOAD_SCHEMAS | undefined;
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
      default_unit_code: string;
      aliases: string[];
    }>(
      `select fc.id, fc.canonical_name, fc.default_unit_code,
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
      defaultUnitCode: row.default_unit_code,
      aliases: row.aliases,
    }));
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function toCandidateItem(item: {
  food_id: string;
  food_name: string;
  quantity: string;
  unit: string;
}): CandidateItem {
  return {
    food_id: item.food_id,
    display_text: item.food_name,
    quantity: item.quantity,
    unit: item.unit,
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
