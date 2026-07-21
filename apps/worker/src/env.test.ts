import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';

describe('loadWorkerEnv', () => {
  it('applies defaults for an empty environment', () => {
    const env = loadWorkerEnv({});
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(2000);
  });

  it('rejects a poll interval below 100ms', () => {
    expect(() => loadWorkerEnv({ WORKER_POLL_INTERVAL_MS: '10' })).toThrow(
      /Invalid worker environment configuration/,
    );
  });
});
