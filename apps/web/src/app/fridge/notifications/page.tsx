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
  const unreadCount = items.filter((item) => item.status === 'UNREAD').length;
  const criticalCount = items.filter((item) => item.severity === 'CRITICAL').length;
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
      <main className="container workspace-page notifications-page">
        {error ? <div className="error-box">{error}</div> : null}
        <section className="workspace-hero workspace-hero-compact">
          <div className="workspace-hero-copy">
            <span>今天的小知提醒</span>
            <h2>{criticalCount > 0 ? '先处理最需要关注的事情' : '今天的安排都在这里'}</h2>
            <p>定时提醒和临期消息分别管理，任何提醒都不会自动修改库存。</p>
          </div>
          <div className="workspace-summary-grid">
            <div>
              <strong>{unreadCount}</strong>
              <span>未读消息</span>
            </div>
            <div className={criticalCount > 0 ? 'attention' : ''}>
              <strong>{criticalCount}</strong>
              <span>优先确认</span>
            </div>
            <div>
              <strong>{reminders.length}</strong>
              <span>定时任务</span>
            </div>
          </div>
        </section>
        <div className="workspace-layout workspace-layout-two">
          <section className="zone workspace-section">
            <div className="workspace-section-heading">
              <div>
                <span>按时间执行</span>
                <h2>定时提醒</h2>
              </div>
              <small>{reminders.length} 项待执行</small>
            </div>
            {reminders.length === 0 ? (
              <p className="empty workspace-empty">目前没有待执行的定时提醒</p>
            ) : (
              <div className="workspace-card-list">
                {reminders.map((reminder) => (
                  <article className="workspace-card" key={reminder.id}>
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
                      {cancelling === reminder.id ? '取消中…' : '取消'}
                    </button>
                  </article>
                ))}
              </div>
            )}
            <p className="workspace-section-note">取消只会移除这次提醒，不会扣减库存。</p>
          </section>
          <section className="zone workspace-section">
            <div className="workspace-section-heading">
              <div>
                <span>按食材状态生成</span>
                <h2>临期与过期</h2>
              </div>
              <small>{items.length} 条消息</small>
            </div>
            {items.length === 0 ? (
              <p className="empty workspace-empty">目前没有需要处理的提醒</p>
            ) : (
              <div className="workspace-card-list">
                {items.map((item) => (
                  <article className="workspace-card workspace-card-stack" key={item.id}>
                    <div>
                      <div className="name">{item.title}</div>
                      <div className="qty">{item.body}</div>
                    </div>
                    <div className="workspace-card-actions">
                      {item.status === 'UNREAD' ? (
                        <button onClick={() => void act(item, 'READ')}>已读</button>
                      ) : null}
                      <button onClick={() => void act(item, 'SNOOZE')}>明天提醒</button>
                      <button className="primary" onClick={() => void act(item, 'ACTIONED')}>
                        去处理
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
        <p className="workspace-footnote">
          “去处理”只标记提醒状态，不会直接扣减库存；实际使用或丢弃仍需在库存操作中确认。
        </p>
      </main>
    </>
  );
}
