import { describe, expect, it, vi } from 'vitest';
import type { InventoryZoneView } from '@xz/contracts';
import {
  extractReminderText,
  reminderQueryPrompt,
  selectInventoryZones,
  VoiceService,
} from './voice.service';

describe('extractReminderText', () => {
  it('keeps a purchase reminder even when the subject is a category', () => {
    expect(extractReminderText('帮我定一个提醒吧明天买绿叶菜')).toBe('买绿叶菜');
  });

  it('supports generic non-food reminders', () => {
    expect(extractReminderText('明天提醒我交水费')).toBe('交水费');
  });

  it('does not turn a food consumption reminder into a purchase action', () => {
    expect(extractReminderText('提醒我明天把猪肉吃完')).toBe('把猪肉吃完');
  });
});

describe('selectInventoryZones', () => {
  const zones = [
    { zone_id: 'fridge', code: 'FRIDGE', name: '冷藏室', items: [] },
    { zone_id: 'freezer', code: 'FREEZER', name: '冷冻室', items: [] },
    { zone_id: 'pantry', code: 'PANTRY', name: '常温区', items: [] },
  ] satisfies InventoryZoneView[];

  it('limits an explicit freezer query to the freezer', () => {
    expect(selectInventoryZones(zones, '冷冷冻区有什么东西啊').map((zone) => zone.code)).toEqual([
      'FREEZER',
    ]);
  });

  it('keeps all zones for a whole-inventory query', () => {
    expect(selectInventoryZones(zones, '冰箱里有什么').map((zone) => zone.code)).toEqual([
      'FRIDGE',
      'FREEZER',
      'PANTRY',
    ]);
  });
});

describe('reminderQueryPrompt', () => {
  const now = new Date('2026-07-22T02:00:00.000Z');

  it('reads tomorrow reminders from stored tasks instead of guessing', () => {
    const prompt = reminderQueryPrompt(
      [
        { reminder_text: '吃掉700克猪肉', scheduled_for: '2026-07-23T04:00:00.000Z' },
        { reminder_text: '买绿叶菜', scheduled_for: '2026-07-24T01:00:00.000Z' },
      ],
      '我明天安排了什么会吃掉啊你看一下',
      'Asia/Shanghai',
      now,
    );
    expect(prompt).toContain('明天的提醒安排是');
    expect(prompt).toContain('12:00吃掉700克猪肉');
    expect(prompt).not.toContain('买绿叶菜');
    expect(prompt).toContain('不会自动扣减库存');
  });

  it('states clearly when the requested day has no reminder', () => {
    expect(reminderQueryPrompt([], '明天有什么提醒吗', 'Asia/Shanghai', now)).toBe(
      '明天没有已设置的提醒安排。',
    );
  });
});

describe('VoiceService clarification cancellation', () => {
  it('cancels a quantity clarification when the user says 不对', async () => {
    const job = {
      id: 'job-1',
      household_id: 'household-1',
      status: 'AWAITING_CLARIFICATION',
      transcript_raw: '我吃猪肉',
      transcript_normalized: '我吃猪肉',
      candidate_command_json: {
        command_type: 'CONSUME_INVENTORY',
        payload: {
          items: [{ food_id: 'pork', display_text: '猪肉', quantity: '1', unit: 'g' }],
        },
      },
      confidence_json: {},
      requires_confirmation: true,
      error_code: null,
      source_channel: 'WEB_VOICE',
      executed_transaction_id: null,
      spoken_prompt: '请问要用掉多少猪肉？',
      turn_count: 1,
      dialogue_turns: [],
      created_at: new Date('2026-07-22T00:00:00.000Z'),
      completed_at: null as Date | null,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from food_catalog fc')) return { rows: [] };
      if (sql.includes('update voice_jobs')) {
        job.status = 'CANCELLED';
        job.spoken_prompt = '好的，已取消。';
        job.completed_at = new Date('2026-07-22T00:01:00.000Z');
        return { rows: [] };
      }
      if (sql.includes('from voice_jobs where id = $1')) return { rows: [job] };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const service = new VoiceService(
      { query } as never,
      { assertMembership: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.reply('job-1', 'user-1', { text: '不对' });

    expect(result.status).toBe('CANCELLED');
    expect(result.spoken_prompt).toBe('好的，已取消。');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'CANCELLED'"), [
      'job-1',
      '好的，已取消。',
      expect.any(String),
    ]);
  });
});
