'use client';

import { useState, type FormEvent } from 'react';
import { AppHeader } from '../../../components/app-header';
import { getSupabase } from '../../../lib/supabase';
import { useHousehold } from '../../../lib/use-household';

export default function SecurityPage() {
  const { household, loading } = useHousehold();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (password.length < 8) return setError('密码至少需要 8 位。');
    if (password !== confirm) return setError('两次输入的密码不一致。');
    setBusy(true);
    try {
      const { error: updateError } = await getSupabase().auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setConfirm('');
      setMessage('密码已更新。系统不会显示或保存你的明文密码。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '密码更新失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !household) return <div className="empty">加载中…</div>;
  return (
    <>
      <AppHeader title="账号与安全" subtitle="密码只用于验证身份，不能被任何页面读取" />
      <main className="container workspace-page settings-page">
        <section className="zone workspace-section security-card">
          <div className="workspace-section-heading">
            <div>
              <span>登录凭据</span>
              <h2>修改密码</h2>
            </div>
          </div>
          <p>
            注册时的密码不会以明文写入家庭业务数据。你可以随时设置新密码；如果使用微信授权登录，也不需要记住邮箱密码。
          </p>
          <form onSubmit={save} className="security-form">
            <div className="field">
              <label htmlFor="new-password">新密码</label>
              <div className="password-input-wrap">
                <input
                  id="new-password"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShow((value) => !value)}
                >
                  {show ? '隐藏' : '显示'}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="confirm-new-password">确认新密码</label>
              <input
                id="confirm-new-password"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            {message ? <div className="success-box">{message}</div> : null}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存新密码'}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
