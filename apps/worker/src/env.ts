import { z } from 'zod';

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

export const WorkerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
    DATABASE_URL: z.string().url().optional(),
    SUPABASE_URL: z.string().url().optional(),
    // 服务端广播需要 service_role key（本地见 supabase status）
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
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

export type WorkerEnv = z.infer<typeof WorkerEnvSchema> & { DATABASE_URL: string };

export function loadWorkerEnv(source: unknown = process.env): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment configuration: ${issues}`);
  }
  return result.data as WorkerEnv;
}
