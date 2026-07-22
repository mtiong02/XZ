'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';
import { AppHeader } from '../../../components/app-header';

/**
 * 设置与隐私（docs/01 §11、docs/02 §15）：数据导出、删除入口与隐私说明。
 */
export default function SettingsPage() {
  const { household, loading } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function exportData() {
    if (!household) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiGet<unknown>(`/households/${household.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `xz-export-${household.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('数据已导出到本地文件。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <AppHeader title="设置与隐私" subtitle="管理数据、授权和更多家庭功能" />
      <main className="container workspace-page settings-page">
        <section className="workspace-hero workspace-hero-compact settings-hero">
          <div className="workspace-hero-copy">
            <span>把选择权交给你</span>
            <h2>功能、数据和隐私都可以清楚管理</h2>
            <p>健康记录默认仅自己可见；家庭数据可以导出，任何删除都不会静默发生。</p>
          </div>
          <div className="workspace-summary-grid settings-principles">
            <div>
              <strong>可查看</strong>
              <span>记录有来源</span>
            </div>
            <div>
              <strong>可导出</strong>
              <span>数据归你</span>
            </div>
            <div>
              <strong>可撤销</strong>
              <span>操作可追溯</span>
            </div>
          </div>
        </section>
        <section className="zone workspace-section">
          <div className="workspace-section-heading">
            <div>
              <span>快速入口</span>
              <h2>常用功能</h2>
            </div>
          </div>
          <div className="settings-link-grid">
            <Link className="settings-link-card" href="/fridge/household">
              <div>
                <div className="name">家庭成员</div>
                <div className="qty">查看成员、邀请家人加入，共同管理这个家庭</div>
              </div>
              <span>进入</span>
            </Link>
            <Link className="settings-link-card" href="/fridge/wellness">
              <div>
                <div className="name">我的健康</div>
                <div className="qty">个人基础、身体指标、饮食建议与共享授权</div>
              </div>
              <span>进入</span>
            </Link>
            <Link className="settings-link-card" href="/fridge/foods">
              <div>
                <div className="name">食材百科</div>
                <div className="qty">食材知识、家庭营养结构与自定义食材</div>
              </div>
              <span>进入</span>
            </Link>
            <Link className="settings-link-card" href="/fridge/timeline">
              <div>
                <div className="name">家庭动态</div>
                <div className="qty">查看操作记录和撤销变更</div>
              </div>
              <span>进入</span>
            </Link>
            <Link className="settings-link-card" href="/fridge/stats">
              <div>
                <div className="name">本周概览</div>
                <div className="qty">查看库存变化与临期处理</div>
              </div>
              <span>进入</span>
            </Link>
          </div>
        </section>
        <div className="workspace-layout workspace-layout-two settings-data-layout">
          <section className="zone workspace-section settings-data-card">
            <div className="workspace-section-heading">
              <div>
                <span>本地副本</span>
                <h2>导出家庭数据</h2>
              </div>
            </div>
            <p>你可以随时导出本家庭的全部数据。原始语音音频从不长期保存。</p>
            <button className="primary" disabled={busy} onClick={exportData}>
              {busy ? '导出中…' : '导出我的数据'}
            </button>
            {message ? <div className="confirm-card settings-message">{message}</div> : null}
          </section>

          <section className="zone workspace-section settings-data-card settings-danger-card">
            <div className="workspace-section-heading">
              <div>
                <span>高风险操作</span>
                <h2>删除数据</h2>
              </div>
            </div>
            <p>
              删除家庭会永久移除库存、记录与语音任务，且不可恢复。仅家庭创建者可发起，并需要再次确认。
            </p>
          </section>
        </div>

        <section className="zone workspace-section privacy-section">
          <div className="workspace-section-heading">
            <div>
              <span>简单说清楚</span>
              <h2>隐私说明</h2>
            </div>
          </div>
          <div className="privacy-grid">
            <div>
              <strong>家庭隔离</strong>
              <p>库存与语音文本属于家庭数据，只向同一家庭的授权成员开放。</p>
            </div>
            <div>
              <strong>健康独立</strong>
              <p>个人健康记录默认仅本人可见，只有主动授权后才向家庭成员共享。</p>
            </div>
            <div>
              <strong>事实分层</strong>
              <p>库存变化不等于个人摄入，系统不会据此生成精确健康结论。</p>
            </div>
            <div>
              <strong>操作可追溯</strong>
              <p>库存写操作需要确认并记录来源；符合条件的错误操作可以撤销。</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
