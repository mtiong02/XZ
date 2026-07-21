'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryView } from '@xz/contracts';
import { ActionModal, type ActionKind } from '../../components/action-modal';
import { VoiceModal } from '../../components/voice-modal';
import { fetchInventory } from '../../lib/api';
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

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      setInventory(await fetchInventory(household.id));
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

  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <header className="topbar">
        <h1>🥬 {household.name}</h1>
        <nav>
          <Link href="/fridge/stats">本周</Link>
          <Link href="/fridge/timeline">动态</Link>
          <Link href="/fridge/settings">设置</Link>
          <button className="ghost" onClick={() => signOut()}>
            退出
          </button>
        </nav>
      </header>

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

        {expiringItems.length > 0 ? (
          <section className="zone">
            <h2>⚠️ 优先处理</h2>
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
            <h2>
              {zone.code === 'FRIDGE' ? '🧊' : zone.code === 'FREEZER' ? '❄️' : '🗄️'} {zone.name}
            </h2>
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
            <p style={{ fontSize: 40 }}>🧺</p>
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
          ＋
        </button>
        <button title="使用食材" aria-label="使用食材" onClick={() => setAction('CONSUME')}>
          🍳
        </button>
        <button
          className="primary"
          title="语音操作"
          aria-label="语音操作"
          onClick={() => setVoiceOpen(true)}
        >
          🎤
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

      {voiceOpen ? (
        <VoiceModal
          householdId={household.id}
          onClose={() => setVoiceOpen(false)}
          onDone={() => {
            setVoiceOpen(false);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
