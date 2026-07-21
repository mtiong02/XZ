import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults for an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
  });

  it('rejects a non-numeric API_PORT', () => {
    expect(() => loadEnv({ API_PORT: 'not-a-port' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
