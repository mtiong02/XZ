'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryView } from '@xz/contracts';
import { ActionModal, type ActionKind } from '../../components/action-modal';
import { ConversationModal } from '../../components/conversation-modal';
import { AppHeader } from '../../components/app-header';
import {
  fetchDailyBriefing,
  fetchInventory,
  fetchNotifications,
  fetchNutritionStructure,
  fetchReminderTasks,
  fetchStorageAudit,
  executeCommand,
  type DailyBriefing,
  type NotificationView,
  type NutritionStructureView,
  type ReminderTaskView,
  type StorageAuditItem,
} from '../../lib/api';
import { EXPIRY_CLASS, EXPIRY_LABEL, formatDate, unitLabel } from '../../lib/format';
import { signOut, useHousehold } from '../../lib/use-household';
import { useRealtimeInventory } from '../../lib/use-realtime';

/** 数字冰箱首页（docs/01 §7.1）。 */
export default function FridgePage() {
  const { household, loading } = useHousehold();
  const [inventory, setInventory] = useState<InventoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [reminders, setReminders] = useState<ReminderTaskView[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [storageAudit, setStorageAudit] = useState<StorageAuditItem[]>([]);
  const [nutrition, setNutrition] = useState<NutritionStructureView | null>(null);
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [
        nextInventory,
        nextNotifications,
        nextReminders,
        nextBriefing,
        nextStorageAudit,
        nextNutrition,
      ] = await Promise.all([
        fetchInventory(household.id),
        fetchNotifications(household.id),
        fetchReminderTasks(household.id),
        fetchDailyBriefing(household.id),
        fetchStorageAudit(household.id),
        fetchNutritionStructure(household.id),
      ]);
      setInventory(nextInventory);
      setNotifications(nextNotifications);
      setReminders(nextReminders);
      setBriefing(nextBriefing);
      setStorageAudit(nextStorageAudit);
      setNutrition(nextNutrition);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [household]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 多端实时同步（docs/01 FR-015）：其他终端的变更 1 秒内反映到本页
  useRealtimeInventory(household?.id ?? null, reload);

  const stats = useMemo(() => {
    if (!inventory) return { total: 0, expiring: 0, expired: 0 };
    const items = inventory.zones.flatMap((zone) => zone.items);
    return {
      total: items.length,
      expiring: items.filter((item) => item.expiry_status === 'EXPIRING').length,
      expired: items.filter((item) => item.expiry_status === 'EXPIRED').length,
    };
  }, [inventory]);

  const expiringItems = useMemo(
    () =>
      inventory?.zones
        .flatMap((zone) => zone.items)
        .filter((item) => item.expiry_status === 'EXPIRING' || item.expiry_status === 'EXPIRED')
        .sort((a, b) => (a.earliest_expiry ?? '').localeCompare(b.earliest_expiry ?? '')) ?? [],
    [inventory],
  );
  const scheduledVoiceReminders = useMemo(
    () =>
      reminders.map((item) => ({
        id: item.id,
        text: item.reminder_text,
        scheduled_for: item.scheduled_for,
      })),
    [reminders],
  );

  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <AppHeader
        title={household.name}
        subtitle="库存、提醒和家庭饮食，一处清楚管理"
        actions={
          <button className="ghost" onClick={() => signOut()}>
            退出
          </button>
        }
      />

      <main className="container">
        <div className="stats">
          <div className="stat-card">
            <div className="num">{stats.total}</div>
            <div className="label">在库食材</div>
          </div>
          <div className={`stat-card${stats.expiring > 0 ? ' warn' : ''}`}>
            <div className="num">{stats.expiring}</div>
            <div className="label">临期</div>
          </div>
          <div className={`stat-card${stats.expired > 0 ? ' danger' : ''}`}>
            <div className="num">{stats.expired}</div>
            <div className="label">已过期</div>
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {nutrition ? (
          <section className="zone">
            <h2>家庭营养结构</h2>
            <p className="sub">
              当前库存覆盖 {nutrition.groups.filter((group) => group.present).length} 个食材类别；
              <Link href="/fridge/foods">查看完整分析</Link>
            </p>
            <div className="items">
              {nutrition.observations.slice(0, 3).map((observation) => (
                <div className="item-card" key={observation.code}>
                  <div>
                    <div className="name">{observation.title}</div>
                    <div className="qty">{observation.detail}</div>
                  </div>
                  <span
                    className={`badge ${observation.severity === 'ATTENTION' ? 'warn' : 'safe'}`}
                  >
                    {observation.severity === 'ATTENTION' ? '建议关注' : '小知分析'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {storageAudit.length > 0 ? (
          <section className="zone storage-guidance">
            <h2>存放建议</h2>
            <p className="sub">
              根据食材类型检查现有位置。移动前需要你确认，操作后仍可在家庭动态中撤销。
            </p>
            <div className="items">
              {storageAudit.map((item) => (
                <article className="item-card" key={`${item.food_id}-${item.current_zone_id}`}>
                  <div>
                    <div className="name">{item.food_name}</div>
                    <div className="qty">
                      当前在{item.current_zone_name}，建议移到{item.recommended_zone_name}
                    </div>
                    <div className="qty">{item.condition_note}</div>
                    <a
                      href={item.source_reference}
                      target="_blank"
                      rel="noreferrer"
                      className="evidence-link"
                    >
                      查看储存依据
                    </a>
                  </div>
                  {pendingMove === item.food_id ? (
                    <div className="storage-confirm">
                      <button className="ghost" onClick={() => setPendingMove(null)}>
                        取消
                      </button>
                      <button
                        className="primary"
                        disabled={moving}
                        onClick={async () => {
                          setMoving(true);
                          try {
                            await executeCommand(household.id, 'MOVE_INVENTORY', {
                              lot_ids: item.lot_ids,
                              target_storage_zone_id: item.recommended_zone_id,
                              reason: 'STORAGE_RECOMMENDATION',
                            });
                            setPendingMove(null);
                            await reload();
                          } catch (caught) {
                            setError(caught instanceof Error ? caught.message : '移动失败');
                          } finally {
                            setMoving(false);
                          }
                        }}
                      >
                        {moving ? '移动中…' : `确认移到${item.recommended_zone_name}`}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setPendingMove(item.food_id)}>调整位置</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {notifications.length > 0 || reminders.length > 0 ? (
          <section className="zone">
            <h2>今日提醒</h2>
            <div className="items">
              {reminders.slice(0, 3).map((item) => (
                <Link className="item-card" href="/fridge/notifications" key={item.id}>
                  <div>
                    <div className="name">{item.reminder_text}</div>
                    <div className="qty">
                      {new Date(item.scheduled_for).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <span className="badge warn">定时</span>
                </Link>
              ))}
              {notifications
                .filter((item) => item.status === 'UNREAD')
                .slice(0, 3)
                .map((item) => (
                  <Link className="item-card" href="/fridge/notifications" key={item.id}>
                    <div>
                      <div className="name">{item.title}</div>
                      <div className="qty">{item.body}</div>
                    </div>
                    <span className={`badge ${item.severity === 'CRITICAL' ? 'danger' : 'warn'}`}>
                      {item.severity === 'CRITICAL' ? '紧急' : '提醒'}
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        ) : null}

        {expiringItems.length > 0 ? (
          <section className="zone">
            <h2>优先处理</h2>
            <div className="items">
              {expiringItems.map((item) => (
                <Link
                  key={`exp-${item.food_id}`}
                  href={`/fridge/food/${item.food_id}`}
                  className="item-card"
                >
                  <div>
                    <div className="name">{item.name}</div>
                    <div className="qty">
                      {item.total_quantity} {unitLabel(item.unit)} ·{' '}
                      {formatDate(item.earliest_expiry)}
                      到期
                    </div>
                  </div>
                  <span className={`badge ${EXPIRY_CLASS[item.expiry_status]}`}>
                    {EXPIRY_LABEL[item.expiry_status]}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {inventory?.zones.map((zone) => (
          <section className="zone" key={zone.zone_id}>
            <h2>{zone.name}</h2>
            {zone.items.length === 0 ? (
              <p className="empty" style={{ padding: '12px' }}>
                空空如也
              </p>
            ) : (
              <div className="items">
                {zone.items.map((item) => (
                  <Link
                    key={item.food_id}
                    href={`/fridge/food/${item.food_id}`}
                    className="item-card"
                  >
                    <div>
                      <div className="name">{item.name}</div>
                      <div className="qty">
                        {item.total_quantity} {unitLabel(item.unit)}
                        {item.lot_count > 1 ? ` · ${item.lot_count} 批` : ''}
                        {item.earliest_expiry ? ` · ${formatDate(item.earliest_expiry)}到期` : ''}
                      </div>
                    </div>
                    <span className={`badge ${EXPIRY_CLASS[item.expiry_status]}`}>
                      {EXPIRY_LABEL[item.expiry_status]}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}

        {inventory && inventory.zones.every((zone) => zone.items.length === 0) ? (
          <div className="empty">
            <p>冰箱还是空的，点右下角 ＋ 添加第一样食材吧</p>
          </div>
        ) : null}
      </main>

      <div className="fab">
        <button
          className="primary"
          title="添加食材"
          aria-label="添加食材"
          onClick={() => setAction('ADD')}
        >
          添加食材
        </button>
        <button title="使用食材" aria-label="使用食材" onClick={() => setAction('CONSUME')}>
          使用食材
        </button>
      </div>

      {action ? (
        <ActionModal
          kind={action}
          householdId={household.id}
          inventory={inventory}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            reload();
          }}
        />
      ) : null}

      <ConversationModal
        householdId={household.id}
        expanded={voiceOpen}
        onOpen={() => setVoiceOpen(true)}
        onClose={() => setVoiceOpen(false)}
        onExecuted={() => reload()}
        dailyBriefing={
          briefing
            ? {
                text: briefing.text,
                should_speak: briefing.should_speak,
                scheduled_time: briefing.preferences.daily_briefing_time,
              }
            : null
        }
        scheduledReminders={scheduledVoiceReminders}
      />
    </>
  );
}
