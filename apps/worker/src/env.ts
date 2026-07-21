import { z } from 'zod';

export const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  DATABASE_URL: z.string().url().optional(),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(source: unknown = process.env): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment configuration: ${issues}`);
  }
  return result.data;
}
