'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import type { TransactionView } from '@xz/contracts';
import { apiGet, executeCommand } from '../../../lib/api';
import { formatDateTime, TRANSACTION_LABEL } from '../../../lib/format';
import { useHousehold } from '../../../lib/use-household';

interface TimelinePage {
  items: TransactionView[];
  next_cursor: string | null;
}

/** 活动时间线（FR-013、FR-014）。 */
export default function TimelinePageView() {
  const { household, loading } = useHousehold();
  const [items, setItems] = useState<TransactionView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUndo, setBusyUndo] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      if (!household) return;
      try {
        const page = await apiGet<TimelinePage>(
          `/households/${household.id}/transactions?limit=30${after ? `&cursor=${after}` : ''}`,
        );
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.next_cursor);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      }
    },
    [household],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function undo(transactionId: string) {
    if (!household) return;
    setBusyUndo(transactionId);
    try {
      await executeCommand(household.id, 'REVERSE_TRANSACTION', {
        transaction_id: transactionId,
        reason: 'USER_UNDO',
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusyUndo(null);
    }
  }

  if (loading || !household) return <div className="empty">加载中…</div>;
  const reversibleCount = items.filter(
    (item) => item.reversed_by_transaction_id === null && item.transaction_type !== 'REVERSAL',
  ).length;

  return (
    <>
      <AppHeader title="家庭动态" subtitle="每次库存变化都有记录，错误操作可以撤销" />
      <main className="container workspace-page timeline-page">
        {error ? <div className="error-box">{error}</div> : null}
        <section className="workspace-hero workspace-hero-compact timeline-hero">
          <div className="workspace-hero-copy">
            <span>每次变化都有来路</span>
            <h2>{items.length > 0 ? '家里的库存变化清清楚楚' : '第一条家庭动态会出现在这里'}</h2>
            <p>记录操作者、来源和时间；符合条件的误操作可以撤销。</p>
          </div>
          <div className="workspace-summary-grid">
            <div>
              <strong>{items.length}</strong>
              <span>已加载动态</span>
            </div>
            <div>
              <strong>{reversibleCount}</strong>
              <span>可撤销</span>
            </div>
            <div>
              <strong>{items.filter((item) => item.reversed_by_transaction_id).length}</strong>
              <span>已撤销</span>
            </div>
          </div>
        </section>
        <section className="zone workspace-section timeline-section">
          <div className="workspace-section-heading">
            <div>
              <span>按时间倒序</span>
              <h2>操作记录</h2>
            </div>
            <small>最近 30 条</small>
          </div>
          {items.length === 0 ? <p className="empty workspace-empty">还没有任何操作记录</p> : null}
          <div className="timeline-list">
            {items.map((txn) => {
              const reversed = txn.reversed_by_transaction_id !== null;
              return (
                <article className={`timeline-item${reversed ? ' reversed' : ''}`} key={txn.id}>
                  <div>
                    <div>
                      <strong>{txn.actor_display_name}</strong>{' '}
                      {TRANSACTION_LABEL[txn.transaction_type] ?? txn.transaction_type}了{' '}
                      {txn.food_name}
                      {txn.quantity_delta && txn.quantity_delta !== '0'
                        ? `（${txn.quantity_delta.replace('-', '')}${txn.unit}）`
                        : ''}
                      {reversed ? ' · 已撤销' : ''}
                    </div>
                    <div className="meta">
                      {formatDateTime(txn.created_at)} · {txn.source_channel}
                    </div>
                  </div>
                  {!reversed && txn.transaction_type !== 'REVERSAL' ? (
                    <button
                      className="ghost"
                      disabled={busyUndo === txn.id}
                      onClick={() => undo(txn.id)}
                    >
                      {busyUndo === txn.id ? '撤销中…' : '撤销'}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          {cursor ? (
            <button className="workspace-load-more" onClick={() => load(cursor)}>
              加载更多
            </button>
          ) : null}
        </section>
      </main>
    </>
  );
}
