'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
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
      <AppHeader title="本周概览" subtitle="只基于已确认的库存变化，不推断个人摄入" />
      <main className="container workspace-page stats-page">
        {error ? <div className="error-box">{error}</div> : null}
        {stats ? (
          <>
            <section className="workspace-hero workspace-hero-compact">
              <div className="workspace-hero-copy">
                <span>最近 {stats.window_days} 天</span>
                <h2>只看真实发生过的库存变化</h2>
                <p>这里不把食材使用推断成任何成员的实际摄入，也不生成健康结论。</p>
              </div>
              <div className="workspace-summary-grid">
                <div>
                  <strong>{stats.consumed_count}</strong>
                  <span>使用次数</span>
                </div>
                <div className={stats.discarded_count > 0 ? 'attention' : ''}>
                  <strong>{stats.discarded_count}</strong>
                  <span>丢弃次数</span>
                </div>
                <div>
                  <strong>{stats.added_count}</strong>
                  <span>入库次数</span>
                </div>
              </div>
            </section>

            <div className="workspace-layout workspace-layout-two">
              <section className="zone workspace-section">
                <div className="workspace-section-heading">
                  <div>
                    <span>新鲜优先</span>
                    <h2>临期处理</h2>
                  </div>
                </div>
                <div className="lot-row">
                  <span>近 7 天临期处理率</span>
                  <strong>
                    {stats.expiry_handled_rate === null
                      ? '暂无临期批次'
                      : `${Math.round(stats.expiry_handled_rate * 100)}%`}
                  </strong>
                </div>
                <div className="lot-row">
                  <span>当前临期</span>
                  <strong>{stats.expiring_count} 批</strong>
                </div>
                <div className="lot-row">
                  <span>当前已过期</span>
                  <strong className={stats.expired_count > 0 ? 'danger-text' : ''}>
                    {stats.expired_count} 批
                  </strong>
                </div>
              </section>

              <section className="zone workspace-section">
                <div className="workspace-section-heading">
                  <div>
                    <span>按基准单位汇总</span>
                    <h2>数量变化</h2>
                  </div>
                </div>
                <div className="lot-row">
                  <span>本周使用总量</span>
                  <strong>{stats.consumed_quantity}</strong>
                </div>
                <div className="lot-row">
                  <span>本周丢弃总量</span>
                  <strong>{stats.discarded_quantity}</strong>
                </div>
              </section>
            </div>
            <p className="workspace-footnote">
              数量按各食材基准单位（{unitLabel('piece')}/{unitLabel('g')}/{unitLabel('ml')}）汇总，
              仅统计库存变化，不代表任何成员的实际摄入。
            </p>
          </>
        ) : null}
      </main>
    </>
  );
}
