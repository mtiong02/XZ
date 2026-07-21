import { z } from 'zod';

/**
 * 环境变量 Schema：外部输入先 unknown，再 parse（docs/07 §4）。
 * 本地默认值与 Supabase CLI 本地栈一致；production 必须显式提供全部值。
 */

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().url().optional(),
    SUPABASE_URL: z.string().url().optional(),
    // GoTrue 校验 token 所需（本地值见 supabase status 的 ANON_KEY）
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    REVERSAL_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  })
  .transform((env) => ({
    ...env,
    DATABASE_URL:
      env.DATABASE_URL ?? (env.NODE_ENV === 'production' ? undefined : LOCAL_DATABASE_URL),
    SUPABASE_URL:
      env.SUPABASE_URL ?? (env.NODE_ENV === 'production' ? undefined : LOCAL_SUPABASE_URL),
  }))
  .refine((env) => env.DATABASE_URL !== undefined, {
    message: 'DATABASE_URL is required in production',
  });

export type Env = z.infer<typeof EnvSchema> & {
  DATABASE_URL: string;
};

export function loadEnv(source: unknown = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data as Env;
}

export const ENV = Symbol('ENV');
