import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { Pool } from 'pg';
import { loadWorkerEnv } from './env';
import { log } from './log';
import { OutboxProcessor } from './outbox-processor';
import {
  LoggingBroadcaster,
  SupabaseRealtimeBroadcaster,
  type Broadcaster,
} from './realtime-broadcaster';

/**
 * Worker 进程（docs/02 §18、docs/04 Sprint 4）：
 * 轮询 outbox，广播实时变更；未来承担临期提醒、音频清理等任务。
 */
async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });

  const broadcaster: Broadcaster =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseRealtimeBroadcaster(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : new LoggingBroadcaster();

  const processor = new OutboxProcessor(
    pool,
    broadcaster,
    env.OUTBOX_BATCH_SIZE,
    env.OUTBOX_MAX_ATTEMPTS,
  );

  log('info', 'worker.started', {
    poll_interval_ms: env.WORKER_POLL_INTERVAL_MS,
    broadcaster: broadcaster.constructor.name,
  });

  let running = true;
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (ticking || !running) return;
    ticking = true;
    try {
      // 排空当前可处理批次，避免积压
      for (;;) {
        const result = await processor.processBatch();
        if (result.processed > 0 || result.deadLettered > 0) {
          log('info', 'outbox.batch', { ...result });
        }
        if (result.processed + result.failed + result.deadLettered === 0) break;
      }
    } catch (error) {
      log('error', 'worker.tick_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, env.WORKER_POLL_INTERVAL_MS);

  const shutdown = (signal: string): void => {
    running = false;
    clearInterval(timer);
    log('info', 'worker.stopped', { signal });
    void pool.end().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  log('error', 'worker.bootstrap_failed', { error: String(error) });
  process.exit(1);
});
