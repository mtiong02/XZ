'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { AppHeader } from '../../../components/app-header';
import {
  addHouseholdMember,
  createHouseholdInvite,
  fetchHouseholdMembers,
  type HouseholdMember,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

const BETA_INVITE_CODE = 'XZ2026';
type InvitePosterKind = 'BETA' | 'HOUSEHOLD';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
    new Date(value),
  );
}

function loadPosterImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

export default function HouseholdPage() {
  const { household, loading } = useHousehold();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sharePosterKind, setSharePosterKind] = useState<InvitePosterKind | null>(null);
  const [shareQrCode, setShareQrCode] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

  const shareIsHouseholdInvite = sharePosterKind === 'HOUSEHOLD';
  const shareInviteUrl = useMemo(() => {
    if (typeof window === 'undefined' || !sharePosterKind) return '';
    const params = new URLSearchParams({ mode: 'signup', invite: BETA_INVITE_CODE });
    if (sharePosterKind === 'HOUSEHOLD' && invite?.code) {
      params.set('family_invite', invite.code);
    }
    return `${window.location.origin}/login?${params.toString()}`;
  }, [invite?.code, sharePosterKind]);

  async function loadMembers() {
    if (!household) return;
    setMembers(await fetchHouseholdMembers(household.id));
  }

  useEffect(() => {
    loadMembers().catch((error) =>
      setMessage(error instanceof Error ? error.message : '成员加载失败'),
    );
  }, [household]);

  useEffect(() => {
    if (!sharePosterKind || !shareInviteUrl) return;
    setShareQrCode('');
    QRCode.toDataURL(shareInviteUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#114c39', light: '#ffffff' },
    })
      .then(setShareQrCode)
      .catch(() => setShareMessage('二维码生成失败，请复制邀请链接发送给朋友。'));
  }, [shareInviteUrl, sharePosterKind]);

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

  async function copyInviteUrl() {
    if (!shareInviteUrl) return;
    await navigator.clipboard?.writeText(shareInviteUrl);
    setShareMessage('邀请链接已复制，发给朋友即可。');
  }

  async function shareInvite() {
    if (!shareInviteUrl) return;
    const text = shareIsHouseholdInvite
      ? `邀请你加入“${household?.name ?? '我的家'}”：注册后会自动带入家庭邀请码，一起管理库存和餐食。`
      : '邀请你体验鲜知：管理家里食材、决定今天吃什么。扫码或打开链接后，内测邀请码会自动填好。';
    setShareBusy(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: shareIsHouseholdInvite
            ? `邀请加入${household?.name ?? '我的家'}`
            : '邀请你体验鲜知',
          text,
          url: shareInviteUrl,
        });
        setShareMessage('已打开系统分享。');
      } else {
        await navigator.clipboard?.writeText(`${text}\n${shareInviteUrl}`);
        setShareMessage('当前设备不支持系统分享，邀请文案和链接已复制。');
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        setShareMessage('暂时无法打开分享，请复制链接发送给朋友。');
      }
    } finally {
      setShareBusy(false);
    }
  }

  async function downloadPoster() {
    if (!shareQrCode) return;
    setShareBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1440;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');

      const gradient = context.createLinearGradient(0, 0, 1080, 1440);
      gradient.addColorStop(0, '#d7f5e6');
      gradient.addColorStop(0.55, '#f8fffb');
      gradient.addColorStop(1, '#e9f8ef');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'rgba(255,255,255,0.82)';
      roundedRect(context, 70, 70, 940, 1300, 58);

      context.fillStyle = '#287a5b';
      context.font = '700 31px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText('鲜知 · 家庭饮食小管家', 130, 158);
      context.fillStyle = '#123c2c';
      context.font = '700 76px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText(shareIsHouseholdInvite ? '一起把这个家' : '今天吃什么，', 130, 307);
      context.fillText(shareIsHouseholdInvite ? '照顾得更好。' : '让小知和你一起想。', 130, 400);
      context.fillStyle = '#5c7468';
      context.font = '400 32px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText(
        shareIsHouseholdInvite
          ? `邀请加入“${household?.name ?? '我的家'}”，共享库存与餐食安排。`
          : '管理食材、减少浪费，也把每一餐安排得更轻松。',
        130,
        482,
      );

      const [mascot, qr] = await Promise.all([
        loadPosterImage('/mascot/xiaozhi.webp?v=20260729'),
        loadPosterImage(shareQrCode),
      ]);
      context.drawImage(mascot, 680, 135, 240, 240);
      context.fillStyle = '#ffffff';
      roundedRect(context, 130, 715, 820, 390, 40);
      context.drawImage(qr, 192, 777, 270, 270);
      context.fillStyle = '#123c2c';
      context.font = '700 43px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText(
        shareIsHouseholdInvite ? '扫码注册并加入家庭' : '扫码注册，即可体验',
        520,
        855,
      );
      context.fillStyle = '#5c7468';
      context.font = '400 30px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText(
        shareIsHouseholdInvite ? '内测码与家庭邀请码已自动带入' : '内测邀请码已自动填入',
        520,
        913,
      );
      context.fillStyle = '#287a5b';
      context.font = '700 29px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText(`内测邀请码 · ${BETA_INVITE_CODE}`, 130, 1245);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Poster export failed');
      const file = new File(
        [blob],
        `鲜知-${shareIsHouseholdInvite ? '家庭邀请' : '内测邀请'}海报.png`,
        { type: 'image/png' },
      );
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '鲜知邀请海报' });
        setShareMessage('已打开系统分享，可保存或发送这张海报。');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(link.href);
        setShareMessage('海报已下载。');
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        setShareMessage('海报导出失败，请稍后重试。');
      }
    } finally {
      setShareBusy(false);
    }
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
                    <div className="family-invite-actions">
                      <button className="ghost" onClick={copyInvite}>
                        复制邀请码
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setShareMessage('');
                          setSharePosterKind('HOUSEHOLD');
                        }}
                      >
                        生成家庭邀请海报
                      </button>
                    </div>
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

          <section className="zone workspace-section family-beta-invite-card">
            <div className="workspace-section-heading">
              <div>
                <span>邀请朋友体验</span>
                <h2>把小知分享给朋友</h2>
              </div>
            </div>
            <p>生成一张内测邀请海报。朋友扫码后会打开注册页，并自动填入邀请码，无需手动输入。</p>
            <button
              className="primary"
              type="button"
              onClick={() => {
                setShareMessage('');
                setSharePosterKind('BETA');
              }}
            >
              生成邀请海报
            </button>
          </section>
        </div>
      </main>
      {sharePosterKind ? (
        <div
          className="beta-invite-backdrop"
          role="presentation"
          onClick={() => setSharePosterKind(null)}
        >
          <section
            className="beta-invite-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="beta-invite-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="beta-invite-close"
              type="button"
              onClick={() => setSharePosterKind(null)}
              aria-label="关闭邀请海报"
            >
              关闭
            </button>
            <div className="beta-invite-poster">
              <div className="beta-invite-poster-topline">鲜知 · 家庭饮食小管家</div>
              <img
                src="/mascot/xiaozhi.webp?v=20260729"
                alt="小知"
                className="beta-invite-mascot"
              />
              <h2 id="beta-invite-title">
                {shareIsHouseholdInvite ? (
                  <>
                    一起把这个家，
                    <br />
                    照顾得更好。
                  </>
                ) : (
                  <>
                    今天吃什么，
                    <br />
                    让小知和你一起想。
                  </>
                )}
              </h2>
              <p>
                {shareIsHouseholdInvite
                  ? `邀请加入“${household.name}”，一起管理库存、餐食与提醒。`
                  : '管理食材、减少浪费，也把每一餐安排得更轻松。'}
              </p>
              <div className="beta-invite-qr-wrap">
                {shareQrCode ? (
                  <img src={shareQrCode} alt="扫码注册鲜知" className="beta-invite-qr" />
                ) : (
                  <span>正在生成二维码…</span>
                )}
                <div>
                  <strong>
                    {shareIsHouseholdInvite ? '扫码注册并加入家庭' : '扫码注册，即可体验'}
                  </strong>
                  <span>
                    {shareIsHouseholdInvite
                      ? '内测码与家庭邀请码已自动带入'
                      : '内测邀请码已自动填入'}
                  </span>
                </div>
              </div>
              <div className="beta-invite-code">内测邀请码 · {BETA_INVITE_CODE}</div>
            </div>
            <div className="beta-invite-actions">
              <button
                className="primary"
                type="button"
                onClick={() => void shareInvite()}
                disabled={shareBusy}
              >
                {shareBusy ? '打开分享中…' : '转发给朋友'}
              </button>
              <button
                type="button"
                onClick={() => void downloadPoster()}
                disabled={!shareQrCode || shareBusy}
              >
                下载海报
              </button>
              <button type="button" onClick={() => void copyInviteUrl()}>
                复制邀请链接
              </button>
              {shareQrCode ? (
                <a href={shareQrCode} download="鲜知-内测邀请二维码.png">
                  保存二维码
                </a>
              ) : null}
            </div>
            {shareMessage ? (
              <p className="beta-invite-status" role="status">
                {shareMessage}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
