'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  addWeightEntry,
  fetchPersonalizedMeals,
  fetchWeightTrend,
  fetchWellnessProfile,
  saveWellnessProfile,
  type PersonalizedMeals,
  type WeightTrend,
  type WellnessGoal,
  type WellnessProfile,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';
import { AppHeader } from '../../../components/app-header';

const ALLERGENS: Array<[string, string]> = [
  ['MILK', '乳制品'],
  ['EGG', '蛋类'],
  ['FISH', '鱼类'],
  ['CRUSTACEAN', '甲壳类'],
  ['MOLLUSK', '软体贝类'],
  ['SOY', '大豆'],
  ['GLUTEN', '含麸质谷物'],
  ['PEANUT', '花生'],
  ['TREE_NUT', '坚果'],
  ['SESAME', '芝麻'],
];
const GOALS: Array<[WellnessGoal, string]> = [
  ['GENERAL_WELLNESS', '日常健康管理'],
  ['WEIGHT_MANAGEMENT', '体重管理'],
  ['MUSCLE_SUPPORT', '增肌支持'],
  ['BALANCED_DIET', '均衡饮食'],
];
const empty: WellnessProfile = {
  birth_year: null,
  height_cm: null,
  goal: 'GENERAL_WELLNESS',
  allergen_codes: [],
  dietary_restrictions: [],
  health_considerations: [],
  share_with_household: false,
};

export default function WellnessPage() {
  const { household, loading } = useHousehold();
  const [profile, setProfile] = useState<WellnessProfile>(empty);
  const [trend, setTrend] = useState<WeightTrend | null>(null);
  const [meals, setMeals] = useState<PersonalizedMeals | null>(null);
  const [weight, setWeight] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [p, w, m] = await Promise.all([
        fetchWellnessProfile(household.id),
        fetchWeightTrend(household.id),
        fetchPersonalizedMeals(household.id),
      ]);
      setProfile(p ?? empty);
      setTrend(w);
      setMeals(m);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [household]);
  useEffect(() => void reload(), [reload]);
  if (loading || !household) return <div className="empty">加载中…</div>;
  const householdId = household.id;

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await saveWellnessProfile(householdId, profile);
      setMessage('个人档案已保存。');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  }
  return (
    <>
      <AppHeader title="我的健康" subtitle="记录个人目标和变化，数据默认仅自己可见" />
      <main className="container">
        <p className="sub" style={{ marginBottom: 16 }}>
          档案默认仅你自己可见；库存是家庭共享数据，体重和健康信息不是。这里不提供诊断或治疗建议。
        </p>
        {error ? <div className="error-box">{error}</div> : null}
        {message ? <div className="success-box">{message}</div> : null}
        <section className="zone">
          <h2>个人档案</h2>
          <form onSubmit={save}>
            <label>
              出生年份
              <input
                type="number"
                min="1900"
                max="2100"
                value={profile.birth_year ?? ''}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    birth_year: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              身高（厘米）
              <input
                type="number"
                min="50"
                max="250"
                step="0.1"
                value={profile.height_cm ?? ''}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    height_cm: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              当前目标
              <select
                value={profile.goal}
                onChange={(e) => setProfile({ ...profile, goal: e.target.value as WellnessGoal })}
              >
                {GOALS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <fieldset style={{ border: 0, padding: 0, margin: '16px 0' }}>
              <legend>需要排除的过敏原</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {ALLERGENS.map(([code, label]) => (
                  <label key={code} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={profile.allergen_codes.includes(code)}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          allergen_codes: e.target.checked
                            ? [...profile.allergen_codes, code]
                            : profile.allergen_codes.filter((x) => x !== code),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              饮食限制（逗号分隔）
              <input
                value={profile.dietary_restrictions.join('，')}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    dietary_restrictions: e.target.value
                      .split(/[，,]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label>
              希望系统留意的信息（自行填写，不作诊断）
              <input
                value={profile.health_considerations.join('，')}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    health_considerations: e.target.value
                      .split(/[，,]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0' }}>
              <input
                type="checkbox"
                checked={profile.share_with_household}
                onChange={(e) => setProfile({ ...profile, share_with_household: e.target.checked })}
              />
              允许同一家庭成员查看此档案和体重记录
            </label>
            <button className="primary" type="submit">
              保存档案
            </button>
          </form>
        </section>
        <section className="zone">
          <h2>体重趋势</h2>
          <div className="qty">
            最新：{trend?.latest_kg ?? '暂无'} kg{' '}
            {trend?.change_kg != null
              ? `· 较首条 ${trend.change_kg > 0 ? '+' : ''}${trend.change_kg} kg`
              : ''}
          </div>
          <form
            style={{ display: 'flex', gap: 8, marginTop: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!weight) return;
              await addWeightEntry(household.id, Number(weight), new Date().toISOString());
              setWeight('');
              await reload();
            }}
          >
            <input
              aria-label="体重"
              type="number"
              min="20"
              max="400"
              step="0.1"
              placeholder="本次体重 kg"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <button className="primary">记录</button>
          </form>
          <div className="items" style={{ marginTop: 12 }}>
            {trend?.entries
              .slice()
              .reverse()
              .slice(0, 8)
              .map((e) => (
                <div className="item-card" key={e.id}>
                  <span>{new Date(e.measured_at).toLocaleDateString('zh-CN')}</span>
                  <strong>{e.value} kg</strong>
                </div>
              ))}
          </div>
        </section>
        <section className="zone">
          <h2>结合库存的候选餐食</h2>
          {meals?.excluded_for_allergens.length ? (
            <div className="error-box">
              已因过敏原排除：{meals.excluded_for_allergens.map((x) => x.name).join('、')}
            </div>
          ) : null}
          <div className="items">
            {meals?.suggestions.map((r) => (
              <article className="item-card" key={r.id}>
                <div>
                  <div className="name">{r.name}</div>
                  <div className="qty">
                    {r.description} · 库存覆盖 {Math.round(r.coverage * 100)}%
                  </div>
                </div>
              </article>
            ))}
          </div>
          <ul className="sub">
            {meals?.limitations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
