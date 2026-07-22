'use client';
import { FormEvent, useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import {
  fetchReminderPreferences,
  updateReminderPreferences,
  type ReminderPreferences,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

export default function ReminderSettingsPage() {
  const { household, loading } = useHousehold();
  const [prefs, setPrefs] = useState<ReminderPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (household) void fetchReminderPreferences(household.id).then(setPrefs);
  }, [household]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!household || !prefs) return;
    setPrefs(await updateReminderPreferences(household.id, prefs));
    setSaved(true);
  }
  if (loading || !household || !prefs) return <div className="empty">加载中…</div>;
  return (
    <>
      <AppHeader title="提醒设置" subtitle="决定何时提示，以及什么时候保持安静" />
      <main className="container workspace-page reminder-settings-page">
        <section className="workspace-hero workspace-hero-compact">
          <div className="workspace-hero-copy">
            <span>适时出现，也懂得保持安静</span>
            <h2>让小知按你的生活节奏提醒</h2>
            <p>每日简报、临期提示和语音播报共用这一套偏好。</p>
          </div>
          <div className="workspace-summary-grid">
            <div>
              <strong>{prefs.daily_briefing_enabled ? '已开启' : '已关闭'}</strong>
              <span>每日简报</span>
            </div>
            <div>
              <strong>{prefs.daily_briefing_time.slice(0, 5)}</strong>
              <span>简报时间</span>
            </div>
            <div>
              <strong>{prefs.expiry_days} 天</strong>
              <span>提前提醒</span>
            </div>
          </div>
        </section>
        <section className="zone workspace-section reminder-preferences-card">
          <div className="workspace-section-heading">
            <div>
              <span>你的偏好</span>
              <h2>提醒方式与时间</h2>
            </div>
          </div>
          <form className="reminder-preferences-form" onSubmit={submit}>
            <div className="preference-card preference-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.daily_briefing_enabled}
                  onChange={(e) => setPrefs({ ...prefs, daily_briefing_enabled: e.target.checked })}
                />{' '}
                <span>
                  <strong>每日简报</strong>
                  <small>汇总临期食材、今日任务和需要补充的东西</small>
                </span>
              </label>
            </div>
            <div className="preference-card">
              <label htmlFor="daily-time">简报时间</label>
              <input
                id="daily-time"
                type="time"
                value={prefs.daily_briefing_time.slice(0, 5)}
                onChange={(e) => setPrefs({ ...prefs, daily_briefing_time: e.target.value })}
              />
            </div>
            <div className="preference-card preference-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.voice_enabled}
                  onChange={(e) => setPrefs({ ...prefs, voice_enabled: e.target.checked })}
                />{' '}
                <span>
                  <strong>小知语音播报</strong>
                  <small>允许小知用声音播报已确认的提醒</small>
                </span>
              </label>
            </div>
            <div className="preference-card">
              <label htmlFor="expiry-days">临期提前天数</label>
              <input
                id="expiry-days"
                type="number"
                min="0"
                max="30"
                value={prefs.expiry_days}
                onChange={(e) => setPrefs({ ...prefs, expiry_days: Number(e.target.value) })}
              />
            </div>
            <div className="preference-card preference-quiet-hours">
              <label>安静时段</label>
              <div>
                <input
                  type="time"
                  value={prefs.quiet_start.slice(0, 5)}
                  onChange={(e) => setPrefs({ ...prefs, quiet_start: e.target.value })}
                />
                <input
                  type="time"
                  value={prefs.quiet_end.slice(0, 5)}
                  onChange={(e) => setPrefs({ ...prefs, quiet_end: e.target.value })}
                />
              </div>
            </div>
            <div className="reminder-form-actions">
              <button className="primary">保存设置</button>
              {saved ? <div className="success-box">设置已保存。</div> : null}
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
