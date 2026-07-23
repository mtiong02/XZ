'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { checkWechatLogin, startWechatLogin } from '../../lib/api';
import { getSupabase } from '../../lib/supabase';

const VALID_INVITE_CODES = ['XZ2026', 'VIP888', 'BUSYBEE', 'XZ666', 'SARA888'];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wechatBusy, setWechatBusy] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const wechatError = new URLSearchParams(window.location.search).get('wechat_error');
    if (wechatError) setError(wechatError);
    checkWechatLogin()
      .then(setWechatEnabled)
      .catch(() => setWechatEnabled(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const code = inviteCode.trim().toUpperCase();
    if (!code || !VALID_INVITE_CODES.includes(code)) {
      setError('邀请码不正确，请输入有效的邀请码');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('密码至少需要 8 位。');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致。');
        return;
      }
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
        setError('注册成功，请使用刚设置的邮箱和密码登录。');
        setMode('signin');
        return;
      }
      router.replace('/');
    } catch (caught) {
      // Supabase 未启动、端口不可达或浏览器网络中断时，SDK 会直接抛出 TypeError。
      // 给用户可操作的提示，不把原始 Failed to fetch 留在控制台和页面上。
      setError(
        caught instanceof TypeError && caught.message === 'Failed to fetch'
          ? '无法连接本地认证服务，请确认 Supabase 已启动后重试。'
          : caught instanceof Error
            ? caught.message
            : '登录服务暂时不可用，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  function handleWechatLogin() {
    const code = inviteCode.trim().toUpperCase();
    if (!code || !VALID_INVITE_CODES.includes(code)) {
      setError('请先输入有效的邀请码，再使用微信授权登录。');
      return;
    }
    if (!wechatEnabled) {
      setError('微信授权登录尚未配置，请先使用邮箱密码登录。');
      return;
    }
    setWechatBusy(true);
    setError(null);
    try {
      startWechatLogin();
    } catch (e) {
      setWechatBusy(false);
      setError(e instanceof Error ? e.message : '微信登录暂不可用');
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
            <div className="password-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
            {mode === 'signup' ? <small className="field-hint">至少 8 位；密码只用于登录，系统不会保存明文。</small> : null}
          </div>
          {mode === 'signup' ? (
            <div className="field">
              <label htmlFor="confirmPassword">确认密码</label>
              <div className="password-input-wrap">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword((value) => !value)}>
                  {showConfirmPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </div>
          ) : null}
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '请稍候…' : mode === 'signin' ? '登录' : '注册'}
          </button>
        </form>
        <div className="auth-divider"><span>或</span></div>
        <button className="wechat-login-button" type="button" onClick={handleWechatLogin} disabled={wechatBusy || wechatEnabled !== true}>
          <span aria-hidden="true">▣</span>
          {wechatBusy ? '正在跳转微信…' : wechatEnabled === null ? '正在检查微信登录…' : wechatEnabled ? '微信授权登录' : '微信授权登录（待配置）'}
        </button>
        <p className="auth-provider-note">微信登录需完成开放平台网站应用配置；未配置时不会影响邮箱密码登录。</p>
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
