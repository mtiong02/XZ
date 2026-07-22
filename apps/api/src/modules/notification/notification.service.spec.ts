import { describe, expect, it, vi } from 'vitest';
import {
  buildExpiryNotification,
  NotificationService,
  normalizeReminderSpeech,
  parseReminderSchedule,
} from './notification.service';

describe('buildExpiryNotification', () => {
  it('marks expired lots as critical and keeps the inventory reference', () => {
    expect(
      buildExpiryNotification({
        lot_id: 'lot-1',
        name: '牛奶',
        remaining_quantity: '2',
        unit: 'box',
        expires_at: '2026-07-20T00:00:00.000Z',
        expiry_status: 'EXPIRED',
        zone_name: '冷藏室',
      }),
    ).toMatchObject({ inventoryRef: 'lot-1', severity: 'CRITICAL', type: 'EXPIRED' });
  });
});

describe('parseReminderSchedule', () => {
  it('parses tomorrow noon without treating it as inventory consumption', () => {
    expect(
      parseReminderSchedule(
        '提醒我明天中午把猪肉吃了',
        new Date('2026-07-21T08:00:00+08:00'),
      )?.toISOString(),
    ).toBe('2026-07-22T04:00:00.000Z');
  });

  it.each(['民天中午十二点', '民间中午十二点', '明田12点', '明明天中午'])(
    'tolerates ASR homophones in "%s"',
    (text) => {
      expect(
        parseReminderSchedule(text, new Date('2026-07-21T08:00:00+08:00'))?.toISOString(),
      ).toBe('2026-07-22T04:00:00.000Z');
    },
  );

  it('keeps noon as 12:00 when the reminder also includes an item quantity', () => {
    expect(
      parseReminderSchedule(
        '明天中午十二点把8个苹果吃了',
        new Date('2026-07-22T08:00:00+08:00'),
      )?.toISOString(),
    ).toBe('2026-07-23T04:00:00.000Z');
  });

  it('does not rewrite unrelated uses of 民间', () => {
    expect(normalizeReminderSpeech('这是一个民间故事')).toBe('这是一个民间故事');
  });
});

describe('NotificationService.cancelReminder', () => {
  it('cancels only a pending reminder and leaves inventory untouched', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'reminder-1', status: 'CANCELLED' }] });
    const assertMembership = vi.fn().mockResolvedValue({ memberId: 'member-1' });
    const service = new NotificationService(
      { query } as never,
      { assertMembership } as never,
      {} as never,
    );

    await expect(service.cancelReminder('household-1', 'reminder-1', 'user-1')).resolves.toEqual({
      id: 'reminder-1',
      status: 'CANCELLED',
    });
    expect(assertMembership).toHaveBeenCalledWith('household-1', 'user-1');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("update reminder_tasks set status='CANCELLED'"),
      ['reminder-1', 'household-1'],
    );
  });

  it('returns a not-found domain error when the reminder is already finished', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new NotificationService(
      { query } as never,
      { assertMembership: vi.fn().mockResolvedValue({ memberId: 'member-1' }) } as never,
      {} as never,
    );

    await expect(
      service.cancelReminder('household-1', 'reminder-1', 'user-1'),
    ).rejects.toMatchObject({
      code: 'REMINDER_NOT_FOUND',
    });
  });
});
