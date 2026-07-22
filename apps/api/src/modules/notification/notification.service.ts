import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';
import { DomainError } from '../inventory/domain/errors';

export const NotificationActionSchema = z.object({
  action: z.enum(['READ', 'SNOOZE', 'ACTIONED']),
  idempotency_key: z.string().min(8).max(100),
});

export const ReminderPreferencesSchema = z.object({
  daily_briefing_enabled: z.boolean(),
  voice_enabled: z.boolean(),
  daily_briefing_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  expiry_days: z.number().int().min(0).max(30),
  quiet_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quiet_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export function normalizeReminderSpeech(text: string): string {
  const normalizedDay = text
    .replace(/明{2,}天/g, '明天')
    .replace(/民天|明田|明添/g, '明天')
    .replace(/民间(?=中午|上午|下午|晚上|早上|早晨|\d{1,2}点|十[一二]?点)/g, '明天');
  const chineseHours: Record<string, string> = {
    十二: '12',
    十一: '11',
    十: '10',
    九: '9',
    八: '8',
    七: '7',
    六: '6',
    五: '5',
    四: '4',
    三: '3',
    二: '2',
    两: '2',
    一: '1',
  };
  return normalizedDay.replace(
    /(十二|十一|十|九|八|七|六|五|四|三|二|两|一)点/g,
    (_, hour: string) => `${chineseHours[hour] ?? hour}点`,
  );
}

export function parseReminderSchedule(text: string, now = new Date()): Date | null {
  const normalized = normalizeReminderSpeech(text);
  const future = new Date(now);
  if (/后天/.test(normalized)) future.setDate(future.getDate() + 2);
  else if (/明天|明日/.test(normalized)) future.setDate(future.getDate() + 1);
  else return null;
  // 优先按时间短语解析，避免“中午十二点把苹果吃了”中的食材数量或其它数字干扰时间。
  const explicit = /(?:上午|早上|早晨|中午|下午|晚上|今晚)?\s*(\d{1,2})点/.exec(normalized)?.[1];
  const hour = explicit
    ? Number(explicit)
    : /中午/.test(normalized)
      ? 12
      : /晚上|今晚/.test(normalized)
        ? 19
        : /下午/.test(normalized)
          ? 15
          : 9;
  if (hour < 0 || hour > 23) return null;
  future.setHours(hour, 0, 0, 0);
  return future;
}

interface ExpiringItem {
  lot_id: string;
  name: string;
  remaining_quantity: string;
  unit: string;
  expires_at: string;
  expiry_status: string;
  zone_name: string;
}

export function buildExpiryNotification(item: ExpiringItem) {
  const expired = item.expiry_status === 'EXPIRED';
  return {
    type: expired ? 'EXPIRED' : 'EXPIRING',
    inventoryRef: item.lot_id,
    dedupeKey: `${expired ? 'expired' : 'expiring'}:${item.lot_id}:${item.expires_at.slice(0, 10)}`,
    title: expired ? `${item.name}已过期` : `${item.name}即将到期`,
    body: `${item.zone_name}还有${item.remaining_quantity}${item.unit}，${expired ? '请确认使用或丢弃' : '建议优先使用'}。`,
    severity: expired ? 'CRITICAL' : 'WARNING',
    metadata: {
      food_name: item.name,
      quantity: item.remaining_quantity,
      unit: item.unit,
      expires_at: item.expires_at,
    },
  } as const;
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(InventoryQueryService) private readonly inventory: InventoryQueryService,
  ) {}

  async syncAndList(householdId: string, userId: string) {
    await this.memberships.assertMembership(householdId, userId);
    const items = (await this.inventory.getExpiring(householdId, userId, 3)) as ExpiringItem[];
    for (const item of items) {
      const notification = buildExpiryNotification(item);
      await this.pool.query(
        `insert into notification_deliveries
           (household_id, notification_type, inventory_ref, dedupe_key, title, body, severity, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (household_id, dedupe_key) do update set title=excluded.title, body=excluded.body, metadata=excluded.metadata`,
        [
          householdId,
          notification.type,
          notification.inventoryRef,
          notification.dedupeKey,
          notification.title,
          notification.body,
          notification.severity,
          JSON.stringify(notification.metadata),
        ],
      );
    }
    const result = await this.pool.query(
      `select id, notification_type, title, body, severity, status, metadata, available_at, snoozed_until
       from notification_deliveries
       where household_id=$1 and (status <> 'SNOOZED' or snoozed_until <= now())
       order by case severity when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end, available_at desc limit 100`,
      [householdId],
    );
    return result.rows;
  }

  async act(
    householdId: string,
    notificationId: string,
    userId: string,
    input: z.infer<typeof NotificationActionSchema>,
  ) {
    await this.memberships.assertMembership(householdId, userId);
    const status = input.action === 'SNOOZE' ? 'SNOOZED' : input.action;
    const result = await this.pool.query(
      `update notification_deliveries set status=$3,
         read_at=case when $3='READ' then now() else read_at end,
         actioned_at=case when $3='ACTIONED' then now() else actioned_at end,
         snoozed_until=case when $3='SNOOZED' then now()+interval '1 day' else snoozed_until end,
         metadata=metadata || jsonb_build_object('last_idempotency_key',$4)
       where id=$1 and household_id=$2
         and coalesce(metadata->>'last_idempotency_key','') <> $4 returning id,status,snoozed_until`,
      [notificationId, householdId, status, input.idempotency_key],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await this.pool.query(
      `select id,status,snoozed_until from notification_deliveries where id=$1 and household_id=$2`,
      [notificationId, householdId],
    );
    if (!existing.rows[0])
      throw new DomainError('NOT_FOUND', 'NOTIFICATION_NOT_FOUND', '提醒不存在。');
    return existing.rows[0];
  }

  async createReminder(
    householdId: string,
    userId: string,
    input: {
      food_id?: string;
      reminder_text: string;
      scheduled_for: string;
      idempotency_key: string;
      source_channel: string;
    },
  ) {
    const member = await this.memberships.assertMembership(householdId, userId);
    const scheduled = new Date(input.scheduled_for);
    if (!Number.isFinite(scheduled.getTime()) || scheduled <= new Date())
      throw new DomainError('VALIDATION', 'REMINDER_TIME_INVALID', '提醒时间必须是未来时间。');
    const result = await this.pool.query(
      `insert into reminder_tasks(household_id,food_id,reminder_text,scheduled_for,idempotency_key,source_channel,created_by_member_id)
       values($1,$2,$3,$4,$5,$6,$7) on conflict(household_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
       returning id,food_id,reminder_text,scheduled_for,status`,
      [
        householdId,
        input.food_id ?? null,
        input.reminder_text,
        scheduled,
        input.idempotency_key,
        input.source_channel,
        member.memberId,
      ],
    );
    return result.rows[0];
  }

  async findPendingReminderForFood(householdId: string, userId: string, foodId: string) {
    await this.memberships.assertMembership(householdId, userId);
    return (
      (
        await this.pool.query<{ id: string }>(
          `select id from reminder_tasks
         where household_id=$1 and food_id=$2 and status='PENDING' and scheduled_for > now()
         order by scheduled_for limit 1`,
          [householdId, foodId],
        )
      ).rows[0] ?? null
    );
  }

  async updateReminder(
    householdId: string,
    reminderId: string,
    userId: string,
    input: { food_id?: string; reminder_text: string; scheduled_for: string },
  ) {
    await this.memberships.assertMembership(householdId, userId);
    const scheduled = new Date(input.scheduled_for);
    if (!Number.isFinite(scheduled.getTime()) || scheduled <= new Date())
      throw new DomainError('VALIDATION', 'REMINDER_TIME_INVALID', '提醒时间必须是未来时间。');
    const result = await this.pool.query(
      `update reminder_tasks set food_id=$3,reminder_text=$4,scheduled_for=$5
       where id=$1 and household_id=$2 and status='PENDING'
       returning id,food_id,reminder_text,scheduled_for,status`,
      [reminderId, householdId, input.food_id ?? null, input.reminder_text, scheduled],
    );
    if (!result.rows[0])
      throw new DomainError('NOT_FOUND', 'REMINDER_NOT_FOUND', '待修改的提醒不存在。');
    return result.rows[0];
  }

  async listReminderTasks(householdId: string, userId: string) {
    await this.memberships.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `select rt.id,rt.reminder_text,rt.scheduled_for,rt.status,fc.canonical_name as food_name from reminder_tasks rt left join food_catalog fc on fc.id=rt.food_id where rt.household_id=$1 and rt.status='PENDING' order by rt.scheduled_for limit 50`,
      [householdId],
    );
    return result.rows;
  }

  async cancelReminder(householdId: string, reminderId: string, userId: string) {
    await this.memberships.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `update reminder_tasks set status='CANCELLED'
       where id=$1 and household_id=$2 and status='PENDING'
       returning id,status`,
      [reminderId, householdId],
    );
    if (!result.rows[0]) {
      throw new DomainError('NOT_FOUND', 'REMINDER_NOT_FOUND', '待处理的提醒不存在或已结束。');
    }
    return result.rows[0];
  }

  async getPreferences(householdId: string, userId: string) {
    await this.memberships.assertMembership(householdId, userId);
    await this.pool.query(
      `insert into reminder_preferences(household_id) values($1) on conflict do nothing`,
      [householdId],
    );
    return (
      await this.pool.query(
        `select daily_briefing_enabled,daily_briefing_time::text,voice_enabled,expiry_days,quiet_start::text,quiet_end::text from reminder_preferences where household_id=$1`,
        [householdId],
      )
    ).rows[0];
  }

  async updatePreferences(
    householdId: string,
    userId: string,
    input: z.infer<typeof ReminderPreferencesSchema>,
  ) {
    await this.memberships.assertMembership(householdId, userId);
    return (
      await this.pool.query(
        `insert into reminder_preferences(household_id,daily_briefing_enabled,daily_briefing_time,voice_enabled,expiry_days,quiet_start,quiet_end) values($1,$2,$3,$4,$5,$6,$7) on conflict(household_id) do update set daily_briefing_enabled=excluded.daily_briefing_enabled,daily_briefing_time=excluded.daily_briefing_time,voice_enabled=excluded.voice_enabled,expiry_days=excluded.expiry_days,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,updated_at=now() returning daily_briefing_enabled,daily_briefing_time::text,voice_enabled,expiry_days,quiet_start::text,quiet_end::text`,
        [
          householdId,
          input.daily_briefing_enabled,
          input.daily_briefing_time,
          input.voice_enabled,
          input.expiry_days,
          input.quiet_start,
          input.quiet_end,
        ],
      )
    ).rows[0];
  }

  async dailyBriefing(householdId: string, userId: string) {
    const [notifications, tasks, preferences] = await Promise.all([
      this.syncAndList(householdId, userId),
      this.listReminderTasks(householdId, userId),
      this.getPreferences(householdId, userId),
    ]);
    const urgent = notifications
      .filter((item: { status: string }) => item.status === 'UNREAD')
      .slice(0, 3);
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = tasks.filter(
      (task: { scheduled_for: Date }) =>
        new Date(task.scheduled_for).toISOString().slice(0, 10) === today,
    );
    const parts: string[] = [];
    if (urgent.length) parts.push(`今天有${urgent.length}条临期或过期提醒`);
    if (todayTasks.length) parts.push(`还有${todayTasks.length}项定时提醒`);
    if (!parts.length) parts.push('今天暂时没有需要特别处理的事项');
    return {
      text: `早上好。${parts.join('，')}。`,
      should_speak: preferences?.daily_briefing_enabled && preferences?.voice_enabled,
      preferences,
      urgent,
      tasks: todayTasks,
    };
  }
}
