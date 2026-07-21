import { z } from 'zod';

/**
 * 各命令的 payload Schema（docs/03 §4）。
 * 业务数量使用 Decimal 字符串传输，不用浮点（docs/07 §4）。
 */

export const DecimalStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal string')
  .refine((value) => Number(value) > 0, 'must be greater than zero');

export const NonNegativeDecimalStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal string');

export const ExpirySourceSchema = z.enum([
  'USER_CONFIRMED',
  'PACKAGE_OCR',
  'RULE_ESTIMATED',
  'UNKNOWN',
]);
export type ExpirySource = z.infer<typeof ExpirySourceSchema>;

export const AddInventoryItemSchema = z.object({
  food_id: z.string().uuid(),
  display_text: z.string().max(100).optional(),
  quantity: DecimalStringSchema,
  unit: z.string().min(1),
  storage_zone_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  expiry_source: ExpirySourceSchema.default('UNKNOWN'),
});

export const AddInventoryPayloadSchema = z.object({
  items: z.array(AddInventoryItemSchema).min(1).max(50),
});
export type AddInventoryPayload = z.infer<typeof AddInventoryPayloadSchema>;

export const ConsumePurposeSchema = z.enum(['MEAL_PREPARATION', 'SHARED', 'OTHER', 'UNKNOWN']);

export const ConsumeInventoryItemSchema = z.object({
  food_id: z.string().uuid(),
  quantity: DecimalStringSchema,
  unit: z.string().min(1),
  allocation: z.enum(['FEFO', 'LOT']).default('FEFO'),
  lot_id: z.string().uuid().optional(),
});

export const ConsumeInventoryPayloadSchema = z.object({
  items: z.array(ConsumeInventoryItemSchema).min(1).max(50),
  // purpose 不是个人摄入事实（docs/03 §4.2）
  purpose: ConsumePurposeSchema.default('UNKNOWN'),
});
export type ConsumeInventoryPayload = z.infer<typeof ConsumeInventoryPayloadSchema>;

export const DiscardReasonSchema = z.enum(['SPOILED', 'EXPIRED', 'DAMAGED', 'OTHER']);

export const DiscardInventoryPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        food_id: z.string().uuid(),
        quantity: DecimalStringSchema,
        unit: z.string().min(1),
        lot_id: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(50),
  reason: DiscardReasonSchema,
});
export type DiscardInventoryPayload = z.infer<typeof DiscardInventoryPayloadSchema>;

export const CorrectInventoryPayloadSchema = z.object({
  food_id: z.string().uuid(),
  target_total_quantity: NonNegativeDecimalStringSchema,
  unit: z.string().min(1),
  reason: z.enum(['PHYSICAL_COUNT', 'INPUT_ERROR', 'OTHER']),
});
export type CorrectInventoryPayload = z.infer<typeof CorrectInventoryPayloadSchema>;

export const MoveInventoryPayloadSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1).max(100),
  target_storage_zone_id: z.string().uuid(),
  reason: z.enum(['STORAGE_RECOMMENDATION', 'USER_CHOICE']),
});
export type MoveInventoryPayload = z.infer<typeof MoveInventoryPayloadSchema>;

export const ReverseTransactionPayloadSchema = z.object({
  transaction_id: z.string().uuid(),
  reason: z.enum(['USER_UNDO', 'DATA_CORRECTION', 'OTHER']),
});
export type ReverseTransactionPayload = z.infer<typeof ReverseTransactionPayloadSchema>;

export const COMMAND_PAYLOAD_SCHEMAS = {
  ADD_INVENTORY: AddInventoryPayloadSchema,
  CONSUME_INVENTORY: ConsumeInventoryPayloadSchema,
  DISCARD_INVENTORY: DiscardInventoryPayloadSchema,
  CORRECT_INVENTORY: CorrectInventoryPayloadSchema,
  MOVE_INVENTORY: MoveInventoryPayloadSchema,
  REVERSE_TRANSACTION: ReverseTransactionPayloadSchema,
} as const;
