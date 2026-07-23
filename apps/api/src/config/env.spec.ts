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

  it('treats blank optional integration secrets as disabled', () => {
    const env = loadEnv({
      SUPABASE_SERVICE_ROLE_KEY: ' ',
      WECHAT_APP_ID: '',
      WECHAT_APP_SECRET: '   ',
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.WECHAT_APP_ID).toBeUndefined();
    expect(env.WECHAT_APP_SECRET).toBeUndefined();
  });
});
