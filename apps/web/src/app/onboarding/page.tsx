'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, joinHousehold } from '../../lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('我的家');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'join') {
        await joinHousehold(inviteCode, displayName);
      } else {
        await apiPost('/households', { name, owner_display_name: displayName });
      }
      router.replace('/fridge');
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{mode === 'create' ? '创建你的家庭' : '加入家庭空间'}</h1>
        <p className="sub">
          {mode === 'create'
            ? '先创建家庭空间，也可以稍后邀请家人一起管理冰箱'
            : '向家庭拥有者索取邀请码，加入后就能共同查看和更新库存'}
        </p>
        <div className="auth-mode-tabs" role="tablist" aria-label="家庭入口">
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            创建家庭
          </button>
          <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            加入已有家庭
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'create' ? (
            <div className="field">
              <label htmlFor="name">家庭名称</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="inviteCode">家庭邀请码</label>
              <input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="例如：XZ-1A2B3C4D"
                required
                autoComplete="off"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="displayName">你的昵称</label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：妈妈、Alex"
              required
            />
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '请稍候…' : mode === 'create' ? '创建家庭' : '加入家庭'}
          </button>
        </form>
      </div>
    </div>
  );
}
