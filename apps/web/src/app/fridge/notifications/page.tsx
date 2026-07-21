'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  actOnNotification,
  cancelReminder,
  fetchNotifications,
  fetchReminderTasks,
  type NotificationView,
  type ReminderTaskView,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';
import { AppHeader } from '../../../components/app-header';

export default function NotificationsPage() {
  const { household, loading } = useHousehold();
  const [items, setItems] = useState<NotificationView[]>([]);
  const [reminders, setReminders] = useState<ReminderTaskView[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [nextItems, nextReminders] = await Promise.all([
        fetchNotifications(household.id),
        fetchReminderTasks(household.id),
      ]);
      setItems(nextItems);
      setReminders(nextReminders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提醒加载失败');
    }
  }, [household]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function act(item: NotificationView, action: 'READ' | 'SNOOZE' | 'ACTIONED') {
    if (!household) return;
    await actOnNotification(household.id, item.id, action);
    await reload();
  }
  async function removeReminder(reminderId: string) {
    if (!household) return;
    setCancelling(reminderId);
    try {
      await cancelReminder(household.id, reminderId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消提醒失败');
    } finally {
      setCancelling(null);
    }
  }
  if (loading || !household) return <div className="empty">加载中…</div>;
  return (
    <>
      <AppHeader
        title="提醒"
        subtitle="集中查看临期、过期和定时任务"
        actions={
          <Link className="btn" href="/fridge/reminder-settings">
            提醒设置
          </Link>
        }
      />
      <main className="container">
        {error ? <div className="error-box">{error}</div> : null}
        <section className="zone">
          <h2>今日摘要</h2>
          <p className="qty">
            {items.filter((i) => i.status === 'UNREAD').length} 条未读 ·{' '}
            {items.filter((i) => i.severity === 'CRITICAL').length} 条需要立即确认 ·{' '}
            {reminders.length} 项定时任务
          </p>
        </section>
        <section className="zone">
          <h2>定时提醒</h2>
          {reminders.length === 0 ? (
            <p className="empty">目前没有待执行的定时提醒</p>
          ) : (
            <div className="items">
              {reminders.map((reminder) => (
                <div className="item-card" key={reminder.id}>
                  <div>
                    <div className="name">{reminder.reminder_text}</div>
                    <div className="qty">
                      {new Date(reminder.scheduled_for).toLocaleString('zh-CN')}
                      {reminder.food_name ? ` · ${reminder.food_name}` : ''}
                    </div>
                  </div>
                  <button
                    className="danger"
                    disabled={cancelling === reminder.id}
                    onClick={() => void removeReminder(reminder.id)}
                  >
                    {cancelling === reminder.id ? '取消中…' : '取消提醒'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="qty" style={{ marginTop: 12 }}>
            取消只会移除这次提醒，不会扣减库存。
          </p>
        </section>
        <section className="zone">
          <h2>临期与过期</h2>
          {items.length === 0 ? (
            <p className="empty">目前没有需要处理的提醒</p>
          ) : (
            <div className="items">
              {items.map((item) => (
                <div className="item-card" key={item.id}>
                  <div>
                    <div className="name">{item.title}</div>
                    <div className="qty">{item.body}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {item.status === 'UNREAD' ? (
                      <button onClick={() => void act(item, 'READ')}>已读</button>
                    ) : null}
                    <button onClick={() => void act(item, 'SNOOZE')}>明天提醒</button>
                    <button className="primary" onClick={() => void act(item, 'ACTIONED')}>
                      去处理
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <p className="qty">
          “去处理”只标记提醒状态，不会直接扣减库存；实际使用或丢弃仍需在库存操作中确认。
        </p>
      </main>
    </>
  );
}
