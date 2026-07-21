import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';

describe('loadWorkerEnv', () => {
  it('applies defaults for an empty environment', () => {
    const env = loadWorkerEnv({});
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(1000);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(8);
    // 开发环境回退到本地库
    expect(env.DATABASE_URL).toContain('54322');
  });

  it('rejects a poll interval below 100ms', () => {
    expect(() => loadWorkerEnv({ WORKER_POLL_INTERVAL_MS: '10' })).toThrow(
      /Invalid worker environment configuration/,
    );
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/);
  });
});
