import type { Pool, PoolClient } from 'pg';
import { log } from './log';
import type { Broadcaster, BroadcastMessage } from './realtime-broadcaster';

/**
 * Transactional Outbox 消费者（docs/02 §12、ADR-011）。
 *
 * 保证：
 * - 幂等消费：processed_at 标记 + FOR UPDATE SKIP LOCKED 防止多 worker 重复处理；
 * - 失败重试：指数退避（available_at 后移）；
 * - 超过阈值进入 dead-letter（dead_lettered_at），不无限重试并告警。
 */

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: string;
  household_id: string;
  payload_json: { revision?: number } | null;
  attempt_count: number;
}

export interface ProcessResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

export class OutboxProcessor {
  constructor(
    private readonly pool: Pool,
    private readonly broadcaster: Broadcaster,
    private readonly batchSize: number,
    private readonly maxAttempts: number,
  ) {}

  async processBatch(): Promise<ProcessResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const rows = await this.claimBatch(client);
      if (rows.length === 0) {
        await client.query('commit');
        return { processed: 0, failed: 0, deadLettered: 0 };
      }

      const messages: BroadcastMessage[] = rows.map((row) => ({
        householdId: row.household_id,
        eventType: row.event_type,
        revision: row.payload_json?.revision ?? null,
        eventId: row.event_id,
      }));

      let result: ProcessResult;
      try {
        await this.broadcaster.broadcast(messages);
        await this.markProcessed(
          client,
          rows.map((row) => row.id),
        );
        result = { processed: rows.length, failed: 0, deadLettered: 0 };
      } catch (error) {
        result = await this.markFailed(client, rows, error);
      }

      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimBatch(client: PoolClient): Promise<OutboxRow[]> {
    const result = await client.query<OutboxRow>(
      `select id, event_id, event_type, household_id, payload_json, attempt_count
       from outbox_events
       where processed_at is null and dead_lettered_at is null and available_at <= now()
       order by id
       for update skip locked
       limit $1`,
      [this.batchSize],
    );
    return result.rows;
  }

  private async markProcessed(client: PoolClient, ids: string[]): Promise<void> {
    await client.query(
      `update outbox_events set processed_at = now() where id = any($1::bigint[])`,
      [ids],
    );
  }

  private async markFailed(
    client: PoolClient,
    rows: OutboxRow[],
    error: unknown,
  ): Promise<ProcessResult> {
    const message = error instanceof Error ? error.message : String(error);
    let deadLettered = 0;
    for (const row of rows) {
      const nextAttempt = row.attempt_count + 1;
      if (nextAttempt >= this.maxAttempts) {
        deadLettered += 1;
        await client.query(
          `update outbox_events
           set attempt_count = $2, last_error = $3, dead_lettered_at = now()
           where id = $1`,
          [row.id, nextAttempt, message.slice(0, 500)],
        );
        log('error', 'outbox.dead_lettered', {
          event_id: row.event_id,
          event_type: row.event_type,
          attempts: nextAttempt,
        });
      } else {
        // 指数退避：2^attempt 秒，上限 5 分钟
        const backoffSeconds = Math.min(2 ** nextAttempt, 300);
        await client.query(
          `update outbox_events
           set attempt_count = $2, last_error = $3,
               available_at = now() + make_interval(secs => $4)
           where id = $1`,
          [row.id, nextAttempt, message.slice(0, 500), backoffSeconds],
        );
      }
    }
    log('warn', 'outbox.broadcast_failed', { count: rows.length, error: message });
    return { processed: 0, failed: rows.length - deadLettered, deadLettered };
  }
}
