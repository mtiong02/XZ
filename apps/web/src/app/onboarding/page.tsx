'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '../../lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('我的家');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost('/households', { name, owner_display_name: displayName });
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
        <h1>创建你的家庭</h1>
        <p className="sub">先创建家庭空间，我们会准备好冷藏、冷冻和常温存放区</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">家庭名称</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
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
            {busy ? '创建中…' : '创建家庭'}
          </button>
        </form>
      </div>
    </div>
  );
}
