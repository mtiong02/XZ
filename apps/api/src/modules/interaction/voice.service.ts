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

interface VoiceJobRow {
  id: string;
  household_id: string;
  status: string;
  transcript_raw: string | null;
  transcript_normalized: string | null;
  candidate_command_json: {
    command_type?: string;
    payload?: unknown;
  } | null;
  confidence_json: unknown;
  requires_confirmation: boolean;
  error_code: string | null;
  source_channel: string;
  executed_transaction_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

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
    const { status, candidate, errorCode } = this.buildOutcome(parsed);

    const inserted = await this.pool.query<{ id: string }>(
      `insert into voice_jobs
         (household_id, actor_member_id, status, locale, source_channel, input_mode,
          transcript_raw, transcript_normalized, candidate_command_json, confidence_json,
          requires_confirmation, error_code, client_request_id)
       values ($1, $2, $3, $4, $5, 'TEXT', $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        input.household_id,
        membership.memberId,
        status,
        input.locale,
        input.channel,
        input.transcript_text,
        normalized,
        candidate ? JSON.stringify(candidate) : null,
        JSON.stringify(parsed.confidence),
        candidate !== null,
        errorCode,
        input.client_request_id ?? null,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('voice job insert returned no row');
    return this.getJob(row.id, userId);
  }

  private buildOutcome(parsed: ParseResult): {
    status: string;
    candidate: { command_type: string; payload: unknown } | null;
    errorCode: string | null;
  } {
    if (parsed.intent === 'QUERY_INVENTORY') {
      // 查询必须有明确食材主体；否则无法回答（也避免注入式文本因命中"库存"字样而被接受）
      if (parsed.items.length === 0) {
        return { status: 'FAILED', candidate: null, errorCode: 'AMBIGUOUS_COMMAND' };
      }
      return {
        status: 'COMPLETED',
        candidate: {
          command_type: 'QUERY_INVENTORY',
          payload: { food_ids: parsed.items.map((item) => item.food_id) },
        },
        errorCode: null,
      };
    }
    const commandType = INTENT_TO_COMMAND[parsed.intent];
    if (!commandType || parsed.items.length === 0) {
      return { status: 'FAILED', candidate: null, errorCode: 'AMBIGUOUS_COMMAND' };
    }

    let payload: unknown;
    if (commandType === 'ADD_INVENTORY') {
      payload = {
        items: parsed.items.map((item) => ({
          food_id: item.food_id,
          display_text: item.food_name,
          quantity: item.quantity,
          unit: item.unit,
        })),
      };
    } else if (commandType === 'CONSUME_INVENTORY') {
      payload = {
        items: parsed.items.map((item) => ({
          food_id: item.food_id,
          quantity: item.quantity,
          unit: item.unit,
        })),
        purpose: 'UNKNOWN',
      };
    } else {
      payload = {
        items: parsed.items.map((item) => ({
          food_id: item.food_id,
          quantity: item.quantity,
          unit: item.unit,
        })),
        reason: 'OTHER',
      };
    }
    // 库存写操作一律需要用户确认（AGENTS.md §2）
    return {
      status: 'AWAITING_CONFIRMATION',
      candidate: { command_type: commandType, payload },
      errorCode: null,
    };
  }

  async getJob(jobId: string, userId: string) {
    const result = await this.pool.query<VoiceJobRow>(
      `select id, household_id, status, transcript_raw, transcript_normalized,
              candidate_command_json, confidence_json, requires_confirmation,
              error_code, source_channel, executed_transaction_id, created_at, completed_at
       from voice_jobs where id = $1`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) throw new DomainError('NOT_FOUND', 'VOICE_JOB_NOT_FOUND', 'Voice job not found.');
    await this.membership.assertMembership(job.household_id, userId);
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
      created_at: job.created_at.toISOString(),
      completed_at: job.completed_at?.toISOString() ?? null,
    };
  }

  /**
   * 确认执行：payload 允许用户在确认卡片上修改过，重新走完整 Schema 校验；
   * household 从任务本身取，不信任客户端（docs/03 §5.3）；
   * idempotency key 由任务 ID 派生，确保一个语音任务最多执行一次。
   */
  async confirm(jobId: string, userId: string, body: z.infer<typeof ConfirmVoiceJobSchema>) {
    const job = await this.loadJobRow(jobId);
    await this.membership.assertMembership(job.household_id, userId);
    if (job.status !== 'AWAITING_CONFIRMATION') {
      throw new DomainError('CONFLICT', 'VOICE_JOB_NOT_CONFIRMABLE', `Voice job is ${job.status}.`);
    }
    const commandType = job.candidate_command_json?.command_type as
      keyof typeof COMMAND_PAYLOAD_SCHEMAS | undefined;
    if (!commandType || !(commandType in COMMAND_PAYLOAD_SCHEMAS)) {
      throw new DomainError('CONFLICT', 'VOICE_JOB_INVALID_CANDIDATE', 'No executable candidate.');
    }
    const payload = body.payload ?? job.candidate_command_json?.payload;

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

    await this.pool.query(
      `update voice_jobs
       set status = 'COMPLETED', executed_transaction_id = $2, completed_at = now()
       where id = $1`,
      [jobId, result.transaction_id],
    );
    return { ...result, voice_job_id: jobId };
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
      `select id, household_id, status, transcript_raw, transcript_normalized,
              candidate_command_json, confidence_json, requires_confirmation,
              error_code, source_channel, executed_transaction_id, created_at, completed_at
       from voice_jobs where id = $1 for update`,
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
