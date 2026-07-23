'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import {
  addHouseholdMember,
  createHouseholdInvite,
  fetchHouseholdMembers,
  type HouseholdMember,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
    new Date(value),
  );
}

export default function HouseholdPage() {
  const { household, loading } = useHousehold();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMembers() {
    if (!household) return;
    setMembers(await fetchHouseholdMembers(household.id));
  }

  useEffect(() => {
    loadMembers().catch((error) =>
      setMessage(error instanceof Error ? error.message : '成员加载失败'),
    );
  }, [household]);

  async function handleInvite() {
    if (!household) return;
    setBusy(true);
    setMessage(null);
    try {
      setInvite(await createHouseholdInvite(household.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '邀请码生成失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPlaceholder() {
    if (!household || !memberName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await addHouseholdMember(household.id, memberName.trim());
      setMemberName('');
      await loadMembers();
      setMessage('已添加家庭成员档案。对方注册后可使用邀请码加入账号。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    await navigator.clipboard?.writeText(invite.code);
    setMessage('邀请码已复制，可以发给家人。');
  }

  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <AppHeader title="家庭成员" subtitle="一起查看库存、安排餐食，也保留每个人的独立账号" />
      <main className="container workspace-page family-page">
        <section className="workspace-hero workspace-hero-compact">
          <div className="workspace-hero-copy">
            <span>家庭空间</span>
            <h2>{household.name}</h2>
            <p>
              当前家庭共有 {members.length}{' '}
              位成员。每位成员使用自己的账号登录，数据仍属于同一个家庭。
            </p>
          </div>
          <div className="workspace-summary-grid">
            <div>
              <strong>{members.length}</strong>
              <span>位成员</span>
            </div>
            <div>
              <strong>{household.role === 'OWNER' ? '拥有者' : '成员'}</strong>
              <span>我的身份</span>
            </div>
            <div>
              <strong>共享</strong>
              <span>库存与餐食</span>
            </div>
          </div>
        </section>

        <div className="workspace-layout workspace-layout-two">
          <section className="zone workspace-section">
            <div className="workspace-section-heading">
              <div>
                <span>成员列表</span>
                <h2>谁在这个家里</h2>
              </div>
            </div>
            <div className="family-member-list">
              {members.map((member) => (
                <div className="family-member-card" key={member.id}>
                  <div className="family-avatar">{member.display_name.slice(0, 1)}</div>
                  <div className="family-member-copy">
                    <strong>{member.display_name}</strong>
                    <span>
                      {member.role === 'OWNER' ? '家庭拥有者' : '家庭成员'} · 加入于{' '}
                      {formatDate(member.created_at)}
                    </span>
                  </div>
                  <span className={member.has_account ? 'family-status account' : 'family-status'}>
                    {member.has_account ? '已关联账号' : '档案成员'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="zone workspace-section family-invite-card">
            <div className="workspace-section-heading">
              <div>
                <span>邀请家人</span>
                <h2>让三个账号进入同一个家庭</h2>
              </div>
            </div>
            {household.role === 'OWNER' ? (
              <>
                <p>
                  生成一个 7 天有效、最多可使用 5
                  次的邀请码。家人在注册后的“加入已有家庭”入口输入即可。
                </p>
                <button className="primary" onClick={handleInvite} disabled={busy}>
                  {busy ? '生成中…' : '生成家庭邀请码'}
                </button>
                {invite ? (
                  <div className="family-invite-code">
                    <strong>{invite.code}</strong>
                    <span>有效期至 {formatDate(invite.expires_at)}</span>
                    <button className="ghost" onClick={copyInvite}>
                      复制邀请码
                    </button>
                  </div>
                ) : null}
                <div className="family-add-row">
                  <input
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="也可以先添加未注册的成员"
                  />
                  <button
                    className="secondary"
                    onClick={handleAddPlaceholder}
                    disabled={busy || !memberName.trim()}
                  >
                    添加档案
                  </button>
                </div>
              </>
            ) : (
              <p>请联系家庭拥有者获取邀请码。加入后，你可以共同查看库存、餐食和提醒。</p>
            )}
            {message ? <div className="confirm-card settings-message">{message}</div> : null}
          </section>
        </div>
      </main>
    </>
  );
}
