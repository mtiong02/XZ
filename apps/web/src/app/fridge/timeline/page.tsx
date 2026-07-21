'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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

  return (
    <>
      <header className="topbar">
        <h1>
          <Link href="/fridge" style={{ textDecoration: 'none' }}>
            ←
          </Link>{' '}
          家庭动态
        </h1>
      </header>
      <main className="container">
        {error ? <div className="error-box">{error}</div> : null}
        {items.length === 0 ? <p className="empty">还没有任何操作记录</p> : null}
        {items.map((txn) => {
          const reversed = txn.reversed_by_transaction_id !== null;
          return (
            <div className={`timeline-item${reversed ? ' reversed' : ''}`} key={txn.id}>
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
            </div>
          );
        })}
        {cursor ? (
          <button style={{ width: '100%', marginTop: 8 }} onClick={() => load(cursor)}>
            加载更多
          </button>
        ) : null}
      </main>
    </>
  );
}
