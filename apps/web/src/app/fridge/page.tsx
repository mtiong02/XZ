'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryView } from '@xz/contracts';
import { ActionModal, type ActionKind } from '../../components/action-modal';
import { ConversationModal } from '../../components/conversation-modal';
import { AppHeader } from '../../components/app-header';
import {
  fetchDailyBriefing,
  fetchInventory,
  fetchReminderTasks,
  fetchShoppingList,
  fetchStorageAudit,
  executeCommand,
  type DailyBriefing,
  type ReminderTaskView,
  type ShoppingListItemView,
  type StorageAuditItem,
} from '../../lib/api';
import { EXPIRY_CLASS, EXPIRY_LABEL, formatDate, unitLabel } from '../../lib/format';
import { signOut, useHousehold } from '../../lib/use-household';
import { useRealtimeInventory } from '../../lib/use-realtime';

type FridgeHighlightTone = 'calm' | 'reminder' | 'warning' | 'danger';

interface FridgeHighlight {
  id: string;
  kicker: string;
  title: string;
  detail: string;
  tone: FridgeHighlightTone;
  href?: string;
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Asia/Shanghai';
  }
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatLocalTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** 数字冰箱首页（docs/01 §7.1）。 */
export default function FridgePage() {
  const { household, loading } = useHousehold();
  const [inventory, setInventory] = useState<InventoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [reminders, setReminders] = useState<ReminderTaskView[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [storageAudit, setStorageAudit] = useState<StorageAuditItem[]>([]);
  const [shopping, setShopping] = useState<ShoppingListItemView[]>([]);
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [highlightPaused, setHighlightPaused] = useState(false);
  const highlightTouchStartY = useRef<number | null>(null);
  const suppressHighlightClick = useRef(false);

  const [ignoredAuditIds, setIgnoredAuditIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('xz-ignored-storage-audit');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const ignoreSuggestion = (foodId: string) => {
    setIgnoredAuditIds((prev) => {
      const next = new Set(prev);
      next.add(foodId);
      try {
        localStorage.setItem('xz-ignored-storage-audit', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const visibleStorageAudit = useMemo(
    () => storageAudit.filter((item) => !ignoredAuditIds.has(item.food_id)),
    [storageAudit, ignoredAuditIds],
  );

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [nextInventory, nextReminders, nextBriefing, nextStorageAudit, nextShopping] =
        await Promise.all([
          fetchInventory(household.id),
          fetchReminderTasks(household.id),
          fetchDailyBriefing(household.id),
          fetchStorageAudit(household.id),
          fetchShoppingList(household.id),
        ]);
      setInventory(nextInventory);
      setReminders(nextReminders);
      setBriefing(nextBriefing);
      setStorageAudit(nextStorageAudit);
      setShopping(nextShopping);
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
    if (!inventory) return { total: 0, expiring: 0, expired: 0, restock: shopping.length };
    const items = inventory.zones.flatMap((zone) => zone.items);
    return {
      total: items.length,
      expiring: items.filter((item) => item.expiry_status === 'EXPIRING').length,
      expired: items.filter((item) => item.expiry_status === 'EXPIRED').length,
      restock: shopping.length,
    };
  }, [inventory, shopping]);

  const occupiedZones = useMemo(
    () => inventory?.zones.filter((zone) => zone.items.length > 0) ?? [],
    [inventory],
  );
  const greeting = useMemo(() => {
    if (stats.expired > 0) return '有我陪你，先把过期食材妥善处理好。';
    if (stats.expiring > 0) return '别让新鲜被忘记，今天先照顾好临期食材。';
    if (stats.total === 0) return '冰箱空一点没关系，我们一起把日子慢慢装满。';
    return '你负责好好生活，冰箱里的新鲜交给小知记着。';
  }, [stats.expired, stats.expiring, stats.total]);
  const timezone = validTimezone(household?.timezone ?? 'Asia/Shanghai');
  const todayReminders = useMemo(() => {
    const today = localDateKey(new Date(), timezone);
    return reminders
      .filter(
        (item) =>
          item.status === 'PENDING' &&
          localDateKey(new Date(item.scheduled_for), timezone) === today,
      )
      .sort(
        (left, right) =>
          new Date(left.scheduled_for).getTime() - new Date(right.scheduled_for).getTime(),
      );
  }, [reminders, timezone]);
  const expiringItems = useMemo(
    () =>
      (inventory?.zones.flatMap((zone) => zone.items) ?? [])
        .filter((item) => item.expiry_status === 'EXPIRING' || item.expiry_status === 'EXPIRED')
        .sort((left, right) => {
          const leftTime = left.earliest_expiry
            ? new Date(left.earliest_expiry).getTime()
            : Number.POSITIVE_INFINITY;
          const rightTime = right.earliest_expiry
            ? new Date(right.earliest_expiry).getTime()
            : Number.POSITIVE_INFINITY;
          return leftTime - rightTime;
        }),
    [inventory],
  );
  const highlights = useMemo<FridgeHighlight[]>(() => {
    const greetingSlide: FridgeHighlight = {
      id: 'greeting',
      kicker: '小知今天也在',
      title: greeting,
      detail:
        stats.restock > 0
          ? `购物清单里还有 ${stats.restock} 样待补充。`
          : '需要记录、提醒或搭配餐食，叫我一声就好。',
      tone: 'calm',
    };
    const reminderSlides: FridgeHighlight[] = todayReminders.slice(0, 4).map((item) => ({
      id: `reminder-${item.id}`,
      kicker: '今日提醒',
      title: item.reminder_text,
      detail: `今天 ${formatLocalTime(item.scheduled_for, timezone)} · 到点提醒，不自动扣减库存`,
      tone: 'reminder',
      href: '/fridge/notifications',
    }));
    const expirySlides: FridgeHighlight[] = expiringItems.slice(0, 4).map((item) => {
      const expired = item.expiry_status === 'EXPIRED';
      return {
        id: `expiry-${item.food_id}`,
        kicker: expired ? '已过期' : '临期食材',
        title: expired ? `${item.name}已经到期` : `${item.name}快到期了`,
        detail: `${item.total_quantity} ${unitLabel(item.unit)}${
          item.earliest_expiry ? ` · ${formatDate(item.earliest_expiry)}到期` : ''
        } · ${expired ? '请先确认状态再处理' : '建议优先安排食用'}`,
        tone: expired ? 'danger' : 'warning',
        href: `/fridge/food/${item.food_id}`,
      };
    });
    return [greetingSlide, ...reminderSlides, ...expirySlides];
  }, [expiringItems, greeting, stats.restock, timezone, todayReminders]);
  const activeHighlight = highlights[Math.min(highlightIndex, highlights.length - 1)] ?? {
    id: 'greeting-fallback',
    kicker: '小知今天也在',
    title: greeting,
    detail: '需要记录、提醒或搭配餐食，叫我一声就好。',
    tone: 'calm' as const,
  };

  useEffect(() => {
    if (highlightIndex < highlights.length) return;
    setHighlightIndex(0);
  }, [highlightIndex, highlights.length]);

  useEffect(() => {
    if (
      highlightPaused ||
      highlights.length < 2 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHighlightIndex((current) => (current + 1) % highlights.length);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [highlightIndex, highlightPaused, highlights.length]);

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
        title="你好，欢迎回家"
        compact
        actions={
          <button className="ghost" onClick={() => signOut()}>
            退出
          </button>
        }
      />

      <main className="container">
        <section
          className={`fridge-greeting tone-${activeHighlight.tone}`}
          aria-label="小知首页信息；手机上滑查看下一条，下滑查看上一条"
          aria-roledescription="轮播"
          onPointerEnter={() => setHighlightPaused(true)}
          onPointerLeave={() => setHighlightPaused(false)}
          onTouchStart={(event) => {
            if (highlights.length < 2 || !window.matchMedia('(max-width: 680px)').matches) {
              return;
            }
            const touch = event.touches.item(0);
            if (!touch) return;
            highlightTouchStartY.current = touch.clientY;
            setHighlightPaused(true);
          }}
          onTouchEnd={(event) => {
            const start = highlightTouchStartY.current;
            const touch = event.changedTouches.item(0);
            highlightTouchStartY.current = null;
            if (start === null || !touch) return;
            const distance = touch.clientY - start;
            if (Math.abs(distance) >= 36) {
              suppressHighlightClick.current = true;
              setHighlightIndex((current) =>
                distance < 0
                  ? (current + 1) % highlights.length
                  : (current - 1 + highlights.length) % highlights.length,
              );
              window.setTimeout(() => {
                suppressHighlightClick.current = false;
              }, 0);
            }
            setHighlightPaused(false);
          }}
          onTouchCancel={() => {
            highlightTouchStartY.current = null;
            setHighlightPaused(false);
          }}
          onClickCapture={(event) => {
            if (!suppressHighlightClick.current) return;
            event.preventDefault();
            event.stopPropagation();
            suppressHighlightClick.current = false;
          }}
          onFocus={() => setHighlightPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHighlightPaused(false);
          }}
        >
          <Image
            className="fridge-greeting-mascot"
            src="/mascot/xiaozhi.png"
            width={132}
            height={132}
            priority
            alt="小知"
          />
          <div className="fridge-highlight-stage">
            <div className="fridge-highlight-copy" key={activeHighlight.id}>
              <span>{activeHighlight.kicker}</span>
              <h2>
                {activeHighlight.href ? (
                  <Link href={activeHighlight.href}>{activeHighlight.title}</Link>
                ) : (
                  activeHighlight.title
                )}
              </h2>
              <p>{activeHighlight.detail}</p>
            </div>
          </div>
          {highlights.length > 1 ? (
            <div className="fridge-highlight-controls" aria-label="信息轮播控制">
              <span aria-live="polite">
                {highlightIndex + 1} / {highlights.length}
              </span>
              <div>
                <button
                  className="ghost"
                  aria-label="上一条信息"
                  onClick={() =>
                    setHighlightIndex(
                      (current) => (current - 1 + highlights.length) % highlights.length,
                    )
                  }
                >
                  上一条
                </button>
                <button
                  className="ghost"
                  aria-label="下一条信息"
                  onClick={() => setHighlightIndex((current) => (current + 1) % highlights.length)}
                >
                  下一条
                </button>
              </div>
            </div>
          ) : null}
        </section>

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
          <div className={`stat-card${stats.restock > 0 ? ' restock' : ''}`}>
            <div className="num">{stats.restock}</div>
            <div className="label">待补充</div>
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="inventory-overview-heading">
          <div>
            <h2>家里的食材</h2>
            <p>按存放位置查看，数量、批次和最近到期日都在这里。</p>
          </div>
        </div>

        {occupiedZones.map((zone) => (
          <section className="zone inventory-zone" key={zone.zone_id}>
            <h2>{zone.name}</h2>
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
          </section>
        ))}

        {inventory && occupiedZones.length === 0 ? (
          <div className="empty inventory-empty">
            <p>冰箱还是空的，添加第一样食材，小知会替你记住。</p>
          </div>
        ) : null}

        {shopping.length > 0 ? (
          <section className="zone restock-zone">
            <div className="zone-heading-row">
              <div>
                <h2>需要补充</h2>
                <p>根据已确认的购物清单显示，不凭数量猜测。</p>
              </div>
              <Link href="/fridge/meals">查看购物清单</Link>
            </div>
            <div className="items">
              {shopping.slice(0, 6).map((item) => (
                <Link className="item-card" href="/fridge/meals" key={item.id}>
                  <div>
                    <div className="name">{item.food_name}</div>
                    <div className="qty">
                      {item.quantity
                        ? `${item.quantity} ${unitLabel(item.unit_code ?? '')}`
                        : '数量待定'}
                      {item.recipe_name ? ` · 用于${item.recipe_name}` : ''}
                    </div>
                  </div>
                  <span className="badge warn">待购买</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {visibleStorageAudit.length > 0 ? (
          <section className="zone storage-guidance">
            <h2>存放建议</h2>
            <p className="sub">
              根据食材类型检查现有位置。移动前需要你确认，操作后仍可在家庭动态中撤销。
            </p>
            <div className="items">
              {visibleStorageAudit.map((item) => (
                <article className="storage-advice-card" key={`${item.food_id}-${item.current_zone_id}`}>
                  <div className="advice-header">
                    <div className="advice-title-row">
                      <span className="advice-food-name">{item.food_name}</span>
                      <span className="badge warn">建议移到{item.recommended_zone_name}</span>
                    </div>
                    <button
                      type="button"
                      className="advice-ignore-btn"
                      title="忽略此建议"
                      onClick={() => ignoreSuggestion(item.food_id)}
                    >
                      忽略
                    </button>
                  </div>

                  <div className="advice-body">
                    <p className="advice-desc">
                      当前在{item.current_zone_name}。{item.condition_note}
                    </p>
                  </div>

                  <div className="advice-footer">
                    <a
                      href={item.source_reference}
                      target="_blank"
                      rel="noreferrer"
                      className="evidence-link"
                    >
                      查看储存依据
                    </a>

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
                      <button className="primary advice-action-btn" onClick={() => setPendingMove(item.food_id)}>
                        调整位置
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

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
        onAddInventory={() => setAction('ADD')}
        onConsumeInventory={() => setAction('CONSUME')}
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
