'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../lib/supabase';

const VALID_INVITE_CODES = ['XZ2026', 'VIP888', 'BUSYBEE', 'XZ666', 'SARA888'];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const code = inviteCode.trim().toUpperCase();
    if (!code || !VALID_INVITE_CODES.includes(code)) {
      setError('邀请码不正确，请输入有效的邀请码');
      return;
    }

    setBusy(true);
    const supabase = getSupabase();
    try {
      const result =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      if (mode === 'signup' && !result.data.session) {
        setError('注册成功，请查收确认邮件后登录。');
        setMode('signin');
        return;
      }
      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>XZ 鲜知</h1>
        <p className="sub">把家里的食材、提醒和饮食安排得清清楚楚</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="inviteCode">邀请码</label>
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="请输入邀请码"
              required
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '请稍候…' : mode === 'signin' ? '登录' : '注册'}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 14, textAlign: 'center' }}>
          {mode === 'signin' ? '还没有账号？' : '已有账号？'}
          <button
            className="ghost"
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? '注册' : '登录'}
          </button>
        </p>
      </div>
    </div>
  );
}
