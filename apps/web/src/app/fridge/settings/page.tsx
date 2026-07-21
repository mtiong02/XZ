'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

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
      <header className="topbar">
        <h1>
          <Link href="/fridge" style={{ textDecoration: 'none' }}>
            ←
          </Link>{' '}
          设置与隐私
        </h1>
      </header>
      <main className="container">
        <h2 className="section-title">你的数据</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-700)', marginBottom: 12 }}>
          你可以随时导出本家庭的全部数据。原始语音音频从不长期保存。
        </p>
        <button className="primary" disabled={busy} onClick={exportData}>
          {busy ? '导出中…' : '导出我的数据'}
        </button>
        {message ? (
          <div className="confirm-card" style={{ marginTop: 12 }}>
            {message}
          </div>
        ) : null}

        <h2 className="section-title">删除数据</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-700)', marginBottom: 12 }}>
          删除家庭将永久移除全部库存、记录与语音任务，且不可恢复。此操作仅家庭创建者可执行，
          请在确认无误后通过账户设置联系我们发起，以避免误删。
        </p>

        <h2 className="section-title">隐私说明</h2>
        <ul style={{ fontSize: 14, color: 'var(--gray-700)', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>库存与语音文本属于家庭机密数据，仅家庭成员可见，按家庭隔离。</li>
          <li>原始语音音频不长期存储；语音识别只保留文本用于确认与审计。</li>
          <li>系统的统计仅反映库存变化，不代表任何成员的实际摄入，也不构成健康或医疗建议。</li>
          <li>所有写操作都需你确认，且可撤销；每次变更都有来源与操作者记录。</li>
        </ul>
      </main>
    </>
  );
}
