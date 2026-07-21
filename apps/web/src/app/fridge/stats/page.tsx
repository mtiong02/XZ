'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fetchWeeklyStats, type WeeklyStats } from '../../../lib/api';
import { unitLabel } from '../../../lib/format';
import { useHousehold } from '../../../lib/use-household';

/**
 * 本周基础统计（FR-018、docs/04 Sprint 5）。
 * 全部基于真实交易，确定性计算；不生成健康或营养结论。
 */
export default function StatsPage() {
  const { household, loading } = useHousehold();
  const [stats, setStats] = useState<WeeklyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      setStats(await fetchWeeklyStats(household.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [household]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <header className="topbar">
        <h1>
          <Link href="/fridge" style={{ textDecoration: 'none' }}>
            ←
          </Link>{' '}
          本周概览
        </h1>
      </header>
      <main className="container">
        {error ? <div className="error-box">{error}</div> : null}
        {stats ? (
          <>
            <p style={{ color: 'var(--gray-500)', fontSize: 14, margin: '4px 0 12px' }}>
              最近 {stats.window_days} 天
            </p>
            <div className="stats">
              <div className="stat-card">
                <div className="num">{stats.consumed_count}</div>
                <div className="label">使用次数</div>
              </div>
              <div className={`stat-card${stats.discarded_count > 0 ? ' warn' : ''}`}>
                <div className="num">{stats.discarded_count}</div>
                <div className="label">丢弃次数</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.added_count}</div>
                <div className="label">入库次数</div>
              </div>
            </div>

            <h2 className="section-title">临期处理</h2>
            <div className="lot-row">
              <span>临期处理率（近 7 天曾临期批次中已处理的比例）</span>
              <strong>
                {stats.expiry_handled_rate === null
                  ? '本周暂无临期批次'
                  : `${Math.round(stats.expiry_handled_rate * 100)}%`}
              </strong>
            </div>
            <div className="lot-row">
              <span>当前临期</span>
              <strong>{stats.expiring_count} 批</strong>
            </div>
            <div className="lot-row">
              <span>当前已过期</span>
              <strong style={{ color: stats.expired_count > 0 ? 'var(--red)' : undefined }}>
                {stats.expired_count} 批
              </strong>
            </div>

            <h2 className="section-title">数量汇总</h2>
            <div className="lot-row">
              <span>本周使用总量</span>
              <strong>{stats.consumed_quantity}</strong>
            </div>
            <div className="lot-row">
              <span>本周丢弃总量</span>
              <strong>{stats.discarded_quantity}</strong>
            </div>
            <p style={{ color: 'var(--gray-500)', fontSize: 12, marginTop: 16 }}>
              数量按各食材基准单位（{unitLabel('piece')}/{unitLabel('g')}/{unitLabel('ml')}）汇总，
              仅统计库存变化，不代表任何成员的实际摄入。
            </p>
          </>
        ) : null}
      </main>
    </>
  );
}
