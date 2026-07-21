import { ChannelSchema, CommandTypeSchema } from '@xz/contracts';
import { z } from 'zod';

/**
 * POST /commands 请求体（docs/02 §9 统一命令模型的 API 表达）。
 * actor_member_id 由服务端从认证上下文解析，不信任客户端提供（docs/03 §5.3 同一原则）。
 */
export const CommandRequestSchema = z.object({
  command_type: CommandTypeSchema,
  schema_version: z.literal('1.0').default('1.0'),
  household_id: z.string().uuid(),
  source: z.object({
    channel: ChannelSchema,
    client: z.string().max(50).optional(),
    interaction_id: z.string().max(100).nullable().optional(),
  }),
  idempotency_key: z.string().min(8).max(100),
  payload: z.unknown(),
});

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
