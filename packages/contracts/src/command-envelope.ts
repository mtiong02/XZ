import { z } from 'zod';

/**
 * 统一命令模型（docs/02 §9、docs/03 §3-4）。
 * 所有入口（手动、语音、未来冰箱贴）的写操作都转换成这个 Envelope。
 */

export const CHANNELS = [
  'WEB_MANUAL',
  'MOBILE_MANUAL',
  'TABLET_MANUAL',
  'WEB_VOICE',
  'MOBILE_VOICE',
  'TABLET_VOICE',
  'FRIDGE_MAGNET_VOICE',
  'SYSTEM_REMINDER',
  'IMPORT_OCR',
  'EXTERNAL_INTEGRATION',
] as const;

export const ChannelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof ChannelSchema>;

export const COMMAND_TYPES = [
  'ADD_INVENTORY',
  'CONSUME_INVENTORY',
  'DISCARD_INVENTORY',
  'CORRECT_INVENTORY',
  'REVERSE_TRANSACTION',
] as const;

export const CommandTypeSchema = z.enum(COMMAND_TYPES);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const CommandSourceSchema = z.object({
  channel: ChannelSchema,
  client: z.string().optional(),
  device_id: z.string().nullable().default(null),
  interaction_id: z.string().nullable().default(null),
});
export type CommandSource = z.infer<typeof CommandSourceSchema>;

export const CommandEnvelopeSchema = z.object({
  command_id: z.string().min(1),
  command_type: CommandTypeSchema,
  schema_version: z.literal('1.0'),
  household_id: z.string().min(1),
  actor_member_id: z.string().min(1),
  source: CommandSourceSchema,
  idempotency_key: z.string().min(1),
  payload: z.unknown(),
  requested_at: z.string().datetime(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
