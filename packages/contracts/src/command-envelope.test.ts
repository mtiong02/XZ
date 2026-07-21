import { describe, expect, it } from 'vitest';
import { CommandEnvelopeSchema } from './command-envelope.js';

const validEnvelope = {
  command_id: 'cmd_01J',
  command_type: 'CONSUME_INVENTORY',
  schema_version: '1.0',
  household_id: 'hh_123',
  actor_member_id: 'member_456',
  source: {
    channel: 'MOBILE_VOICE',
    device_id: null,
    interaction_id: 'int_789',
  },
  idempotency_key: 'client-generated-key',
  payload: { items: [] },
  requested_at: '2026-07-21T03:00:00Z',
};

describe('CommandEnvelopeSchema', () => {
  it('accepts a valid envelope', () => {
    const result = CommandEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown command_type', () => {
    const result = CommandEnvelopeSchema.safeParse({
      ...validEnvelope,
      command_type: 'DROP_ALL_TABLES',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing idempotency_key', () => {
    const { idempotency_key: _omitted, ...rest } = validEnvelope;
    const result = CommandEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported schema_version', () => {
    const result = CommandEnvelopeSchema.safeParse({ ...validEnvelope, schema_version: '2.0' });
    expect(result.success).toBe(false);
  });
});
