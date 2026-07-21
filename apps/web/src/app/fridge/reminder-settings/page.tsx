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
      <main className="container">
        <section className="zone">
          <form onSubmit={submit}>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.daily_briefing_enabled}
                  onChange={(e) => setPrefs({ ...prefs, daily_briefing_enabled: e.target.checked })}
                />{' '}
                开启每日简报
              </label>
            </div>
            <div className="field">
              <label htmlFor="daily-time">简报时间</label>
              <input
                id="daily-time"
                type="time"
                value={prefs.daily_briefing_time.slice(0, 5)}
                onChange={(e) => setPrefs({ ...prefs, daily_briefing_time: e.target.value })}
              />
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.voice_enabled}
                  onChange={(e) => setPrefs({ ...prefs, voice_enabled: e.target.checked })}
                />{' '}
                小知语音播报
              </label>
            </div>
            <div className="field">
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
            <div className="field">
              <label>安静时段</label>
              <div style={{ display: 'flex', gap: 8 }}>
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
            {saved ? <div className="success-box">设置已保存。</div> : null}
            <button className="primary">保存设置</button>
          </form>
        </section>
      </main>
    </>
  );
}
