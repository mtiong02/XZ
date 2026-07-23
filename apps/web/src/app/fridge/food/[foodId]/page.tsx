'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { InventoryView } from '@xz/contracts';
import { ActionModal, type ActionKind } from '../../../../components/action-modal';
import { AppHeader } from '../../../../components/app-header';
import { apiGet, executeCommand, fetchInventory } from '../../../../lib/api';
import {
  EXPIRY_CLASS,
  EXPIRY_LABEL,
  formatDate,
  formatDateTime,
  formatExpiryRelative,
  formatInventoryQuantity,
  TRANSACTION_LABEL,
} from '../../../../lib/format';
import { useHousehold } from '../../../../lib/use-household';

interface FoodDetail {
  food: {
    id: string;
    canonical_name: string;
    category: string;
    default_unit_code: string;
  };
  lots: {
    id: string;
    remaining_quantity: string;
    initial_quantity: string;
    unit_code: string;
    purchased_at: string;
    expires_at: string | null;
    expiry_source: string;
    expiry_status: 'NORMAL' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';
    zone_name: string;
  }[];
  transactions: {
    id: string;
    transaction_type: string;
    quantity_delta: string | null;
    actor_display_name: string;
    created_at: string;
    reversed: boolean;
  }[];
}

/** 食材详情（docs/01 §7.4）：批次、来源、记录、撤销与修正入口。 */
export default function FoodDetailPage() {
  const params = useParams<{ foodId: string }>();
  const { household, loading } = useHousehold();
  const [detail, setDetail] = useState<FoodDetail | null>(null);
  const [inventory, setInventory] = useState<InventoryView | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUndo, setBusyUndo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [d, inv] = await Promise.all([
        apiGet<FoodDetail>(`/households/${household.id}/foods/${params.foodId}/detail`),
        fetchInventory(household.id),
      ]);
      setDetail(d);
      setInventory(inv);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [household, params.foodId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function undo(transactionId: string) {
    if (!household) return;
    setBusyUndo(transactionId);
    try {
      await executeCommand(household.id, 'REVERSE_TRANSACTION', {
        transaction_id: transactionId,
        reason: 'USER_UNDO',
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusyUndo(null);
    }
  }

  if (loading || !household) return <div className="empty">加载中…</div>;

  const total = detail?.lots.reduce((sum, lot) => sum + Number(lot.remaining_quantity), 0) ?? 0;

  return (
    <>
      <AppHeader
        title={detail?.food.canonical_name ?? '食材详情'}
        subtitle={
          detail
            ? `当前共 ${formatInventoryQuantity(total, detail.food.default_unit_code)}`
            : '当前库存'
        }
      />

      <main className="container">
        {error ? <div className="error-box">{error}</div> : null}

        <h2 className="section-title">库存批次（按到期日排序）</h2>
        {detail?.lots.length === 0 ? <p className="empty">当前无库存</p> : null}
        {detail?.lots.map((lot) => (
          <div className="lot-row" key={lot.id}>
            <div>
              <div>
                {formatInventoryQuantity(lot.remaining_quantity, lot.unit_code)} /{' '}
                {formatInventoryQuantity(lot.initial_quantity, lot.unit_code)} ·{' '}
                {lot.zone_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                {formatDate(lot.purchased_at)}加入
                {lot.expires_at
                  ? ` · ${formatExpiryRelative(lot.expires_at)}${
                      lot.expiry_source === 'RULE_ESTIMATED' ? '（估算）' : ''
                    }`
                  : ''}
              </div>
            </div>
            <span className={`badge ${EXPIRY_CLASS[lot.expiry_status]}`}>
              {EXPIRY_LABEL[lot.expiry_status]}
            </span>
          </div>
        ))}

        <h2 className="section-title">最近记录</h2>
        {detail?.transactions.map((txn) => (
          <div className={`timeline-item${txn.reversed ? ' reversed' : ''}`} key={txn.id}>
            <div>
              <div>
                {TRANSACTION_LABEL[txn.transaction_type] ?? txn.transaction_type}
                {txn.quantity_delta
                  ? ` ${txn.quantity_delta.startsWith('-') ? '' : '+'}${txn.quantity_delta}`
                  : ''}
                {txn.reversed ? '（已撤销）' : ''}
              </div>
              <div className="meta">
                {txn.actor_display_name} · {formatDateTime(txn.created_at)}
              </div>
            </div>
            {!txn.reversed && txn.transaction_type !== 'REVERSAL' ? (
              <button className="ghost" disabled={busyUndo === txn.id} onClick={() => undo(txn.id)}>
                {busyUndo === txn.id ? '撤销中…' : '撤销'}
              </button>
            ) : null}
          </div>
        ))}

        <div className="food-detail-actions" aria-label="食材库存操作">
          <button className="primary" onClick={() => setAction('ADD')}>
            添加
          </button>
          <button onClick={() => setAction('CONSUME')}>使用</button>
          <button onClick={() => setAction('DISCARD')}>丢弃</button>
          <button onClick={() => setAction('CORRECT')}>修正库存</button>
        </div>
      </main>

      {action ? (
        <ActionModal
          kind={action}
          householdId={household.id}
          inventory={inventory}
          presetFoodId={params.foodId}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
