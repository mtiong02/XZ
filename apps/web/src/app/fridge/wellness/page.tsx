'use client';

import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import {
  addBodyMeasurement,
  deleteBodyMeasurement,
  fetchBodyMeasurements,
  fetchPersonalizedMeals,
  fetchWellnessProfile,
  saveWellnessProfile,
  type ActivityLevel,
  type BodyMeasurementSummary,
  type BodyMeasurementTrend,
  type MeasurementMetric,
  type PersonalizedMeals,
  type WellnessGoal,
  type WellnessProfile,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

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
const ACTIVITY_LEVELS: Array<[ActivityLevel, string]> = [
  ['LOW', '日常活动较少'],
  ['MODERATE', '日常活动适中'],
  ['HIGH', '日常活动较多'],
];
interface MetricDefinition {
  value: MeasurementMetric;
  label: string;
  shortLabel: string;
  unit: string;
  placeholder: string;
  min: number;
  max: number;
  help: string;
}
const DEFAULT_METRIC: MetricDefinition = {
  value: 'WEIGHT',
  label: '体重',
  shortLabel: '体重',
  unit: 'kg',
  placeholder: '例如 68.5',
  min: 20,
  max: 400,
  help: '建议在相近时段、相近状态下记录，更适合观察长期变化。',
};
const METRICS: MetricDefinition[] = [
  DEFAULT_METRIC,
  {
    value: 'WAIST_CIRCUMFERENCE',
    label: '腰围',
    shortLabel: '腰围',
    unit: 'cm',
    placeholder: '例如 82.0',
    min: 30,
    max: 250,
    help: '软尺水平环绕腰部，正常呼气后读取；保持每次测量方法一致。',
  },
  {
    value: 'BODY_FAT_PERCENT',
    label: '体脂率',
    shortLabel: '体脂',
    unit: '%',
    placeholder: '例如 22.5',
    min: 1,
    max: 75,
    help: '不同设备算法可能有偏差，适合观察同一设备下的趋势。',
  },
  {
    value: 'RESTING_HEART_RATE',
    label: '静息心率',
    shortLabel: '心率',
    unit: '次/分',
    placeholder: '例如 68',
    min: 25,
    max: 250,
    help: '安静休息后记录；单次结果不用于健康诊断。',
  },
  {
    value: 'BLOOD_PRESSURE',
    label: '血压',
    shortLabel: '血压',
    unit: 'mmHg',
    placeholder: '收缩压，例如 118',
    min: 40,
    max: 300,
    help: '使用经过验证的上臂式设备，安静休息后同时记录收缩压与舒张压。',
  },
];
const empty: WellnessProfile = {
  birth_year: null,
  height_cm: null,
  goal: 'GENERAL_WELLNESS',
  activity_level: 'MODERATE',
  allergen_codes: [],
  dietary_restrictions: [],
  health_considerations: [],
  share_with_household: false,
};

type WellnessPanel = 'profile' | 'body' | 'nutrition';

function goalLabel(goal: WellnessGoal): string {
  return GOALS.find(([value]) => value === goal)?.[1] ?? '日常健康管理';
}

function activityLabel(level: ActivityLevel): string {
  return ACTIVITY_LEVELS.find(([value]) => value === level)?.[1] ?? '日常活动适中';
}

function localDateTimeInput(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function trendDisplay(trend: BodyMeasurementTrend): string {
  if (trend.metric_type === 'BLOOD_PRESSURE' && trend.latest_secondary_value != null) {
    return `${trend.latest_value}/${trend.latest_secondary_value}`;
  }
  return `${trend.latest_value}`;
}

export default function WellnessPage() {
  const { household, loading } = useHousehold();
  const [profile, setProfile] = useState<WellnessProfile>(empty);
  const [measurements, setMeasurements] = useState<BodyMeasurementSummary | null>(null);
  const [meals, setMeals] = useState<PersonalizedMeals | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MeasurementMetric>('WEIGHT');
  const [primaryValue, setPrimaryValue] = useState('');
  const [secondaryValue, setSecondaryValue] = useState('');
  const [measuredAt, setMeasuredAt] = useState(localDateTimeInput);
  const [measurementNote, setMeasurementNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [recordingMeasurement, setRecordingMeasurement] = useState(false);
  const [deletingMeasurementId, setDeletingMeasurementId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<WellnessPanel | null>(null);

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [nextProfile, nextMeasurements, nextMeals] = await Promise.all([
        fetchWellnessProfile(household.id),
        fetchBodyMeasurements(household.id),
        fetchPersonalizedMeals(household.id),
      ]);
      setProfile(nextProfile ?? empty);
      setMeasurements(nextMeasurements);
      setMeals(nextMeals);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败');
    }
  }, [household]);

  useEffect(() => void reload(), [reload]);

  useEffect(() => {
    if (!activePanel) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivePanel(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activePanel]);

  const selectedDefinition = useMemo(
    () => METRICS.find((metric) => metric.value === selectedMetric) ?? DEFAULT_METRIC,
    [selectedMetric],
  );
  const selectedTrend = measurements?.metrics.find(
    (metric) => metric.metric_type === selectedMetric,
  );
  const latestWeight = measurements?.metrics.find((metric) => metric.metric_type === 'WEIGHT');
  const latestWaist = measurements?.metrics.find(
    (metric) => metric.metric_type === 'WAIST_CIRCUMFERENCE',
  );

  if (loading || !household) return <div className="empty">加载中…</div>;

  const householdId = household.id;
  const hasProfile =
    profile.birth_year !== null ||
    profile.height_cm !== null ||
    profile.allergen_codes.length > 0 ||
    profile.dietary_restrictions.length > 0 ||
    profile.health_considerations.length > 0;
  const topMeal = meals?.suggestions.at(0);

  function openPanel(panel: WellnessPanel) {
    setMessage('');
    setError('');
    setActivePanel(panel);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    try {
      await saveWellnessProfile(householdId, profile);
      setMessage('个人健康基础已保存。');
      setActivePanel(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSavingProfile(false);
    }
  }

  async function recordMeasurement(event: FormEvent) {
    event.preventDefault();
    if (!primaryValue) return;
    setRecordingMeasurement(true);
    setError('');
    setMessage('');
    try {
      await addBodyMeasurement(householdId, {
        metric_type: selectedMetric,
        value: Number(primaryValue),
        ...(selectedMetric === 'BLOOD_PRESSURE' ? { secondary_value: Number(secondaryValue) } : {}),
        measured_at: new Date(measuredAt).toISOString(),
        ...(measurementNote.trim() ? { note: measurementNote.trim() } : {}),
      });
      setPrimaryValue('');
      setSecondaryValue('');
      setMeasurementNote('');
      setMeasuredAt(localDateTimeInput());
      setMessage(`${selectedDefinition.label}已记录。`);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '身体指标记录失败');
    } finally {
      setRecordingMeasurement(false);
    }
  }

  const panelTitles: Record<WellnessPanel, { title: string; subtitle: string }> = {
    profile: {
      title: '个人健康基础',
      subtitle: '集中管理基本信息、生活目标、饮食限制与共享授权',
    },
    body: {
      title: '身体指标与趋势',
      subtitle: '记录体重、腰围、体脂、静息心率和血压，关注长期变化',
    },
    nutrition: {
      title: '个性饮食建议',
      subtitle: '先按过敏原和个人目标过滤，再结合家庭库存给出候选',
    },
  };

  return (
    <>
      <AppHeader title="我的健康" subtitle="个人记录、身体趋势与饮食方向，默认仅自己可见" />
      <main className="container wellness-page">
        <section className="wellness-hero" aria-labelledby="wellness-overview-title">
          <div className="wellness-hero-heading">
            <span className="wellness-private-label">个人空间 · 仅自己可见</span>
            <h2 id="wellness-overview-title">小知陪你看见长期变化</h2>
            <p>从真实记录出发，不用一次填完；点击卡片进入对应模块。</p>
          </div>

          <div className="wellness-orbit">
            <button
              className="wellness-module-card wellness-module-profile"
              type="button"
              onClick={() => openPanel('profile')}
            >
              <span>个人健康基础</span>
              <strong>{hasProfile ? goalLabel(profile.goal) : '先建立个人基础'}</strong>
              <small>
                {profile.birth_year ?? '出生年份待填'} ·{' '}
                {profile.height_cm == null ? '身高待填' : `${profile.height_cm} cm`} ·{' '}
                {activityLabel(profile.activity_level)}
              </small>
              <i>档案、目标与隐私</i>
            </button>

            <div className="wellness-avatar" aria-label="小知个人健康伙伴默认形象">
              <div className="wellness-avatar-halo" aria-hidden="true" />
              <Image
                src="/mascot/xiaozhi.webp?v=20260729"
                alt="小知个人健康伙伴"
                width={220}
                height={220}
                priority
              />
              <strong>我的健康伙伴</strong>
              <span>
                {measurements?.total_entries
                  ? `已陪你记录 ${measurements.total_entries} 次变化`
                  : '从第一条真实记录开始'}
              </span>
            </div>

            <button
              className="wellness-module-card wellness-module-weight"
              type="button"
              onClick={() => openPanel('body')}
            >
              <span>身体指标与趋势</span>
              <strong>{latestWeight ? `${latestWeight.latest_value} kg` : '还没有身体记录'}</strong>
              <small>
                {measurements?.derived.bmi
                  ? `BMI ${measurements.derived.bmi.value} · 仅作筛查参考`
                  : latestWaist
                    ? `腰围 ${latestWaist.latest_value} cm`
                    : '可记录 5 类常用指标'}
              </small>
              <i>记录与查看趋势</i>
            </button>

            <button
              className="wellness-module-card wellness-module-meals"
              type="button"
              onClick={() => openPanel('nutrition')}
            >
              <span>个性饮食建议</span>
              <strong>{topMeal?.name ?? '等待合适搭配'}</strong>
              <small>
                {meals?.suggestions.length
                  ? `${meals.suggestions.length} 个候选 · 已按个人限制过滤`
                  : '完善档案和库存后生成'}
              </small>
              <i>依据、候选与局限</i>
            </button>
          </div>

          <div className="wellness-privacy-note">
            <strong>
              {profile.allergen_codes.length > 0
                ? `已记录 ${profile.allergen_codes.length} 项需避开的过敏原`
                : '过敏原尚未设置'}
            </strong>
            <span>小知只整理你确认过的记录，不把库存变化当成实际摄入。</span>
          </div>
        </section>

        {error && !activePanel ? <div className="error-box wellness-toast">{error}</div> : null}
        {message && !activePanel ? (
          <div className="success-box wellness-toast">{message}</div>
        ) : null}
      </main>

      {activePanel ? (
        <div
          className="wellness-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActivePanel(null);
          }}
        >
          <section
            className="wellness-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wellness-dialog-title"
          >
            <header className="wellness-dialog-header">
              <div>
                <span>小知个人健康伙伴</span>
                <h2 id="wellness-dialog-title">{panelTitles[activePanel].title}</h2>
                <p>{panelTitles[activePanel].subtitle}</p>
              </div>
              <button
                className="ghost"
                type="button"
                aria-label="关闭"
                onClick={() => setActivePanel(null)}
              >
                关闭
              </button>
            </header>

            {error ? <div className="error-box">{error}</div> : null}
            {message ? <div className="success-box">{message}</div> : null}

            {activePanel === 'body' ? (
              <div className="wellness-dialog-content">
                <div className="wellness-vitals-grid" aria-label="身体指标概览">
                  {METRICS.map((definition) => {
                    const trend = measurements?.metrics.find(
                      (metric) => metric.metric_type === definition.value,
                    );
                    return (
                      <button
                        type="button"
                        className={selectedMetric === definition.value ? 'active' : ''}
                        key={definition.value}
                        onClick={() => {
                          setSelectedMetric(definition.value);
                          setPrimaryValue('');
                          setSecondaryValue('');
                        }}
                      >
                        <span>{definition.shortLabel}</span>
                        <strong>{trend ? trendDisplay(trend) : '—'}</strong>
                        <small>{trend ? definition.unit : '待记录'}</small>
                      </button>
                    );
                  })}
                  <div className="wellness-bmi-card">
                    <span>BMI</span>
                    <strong>{measurements?.derived.bmi?.value ?? '—'}</strong>
                    <small>身高与最新体重计算</small>
                  </div>
                </div>

                <form className="wellness-measurement-form" onSubmit={recordMeasurement}>
                  <div className="wellness-form-title">
                    <div>
                      <span>新增手工记录</span>
                      <h3>{selectedDefinition.label}</h3>
                    </div>
                    <small>来源：本人手工记录</small>
                  </div>
                  <p>{selectedDefinition.help}</p>
                  <div className="wellness-measurement-fields">
                    <label>
                      {selectedMetric === 'BLOOD_PRESSURE' ? '收缩压' : selectedDefinition.label}
                      <span className="wellness-weight-input">
                        <input
                          aria-label={
                            selectedMetric === 'BLOOD_PRESSURE'
                              ? '收缩压'
                              : selectedDefinition.label
                          }
                          type="number"
                          min={selectedDefinition.min}
                          max={selectedDefinition.max}
                          step="0.1"
                          required
                          placeholder={selectedDefinition.placeholder}
                          value={primaryValue}
                          onChange={(event) => setPrimaryValue(event.target.value)}
                        />
                        <span>{selectedDefinition.unit}</span>
                      </span>
                    </label>
                    {selectedMetric === 'BLOOD_PRESSURE' ? (
                      <label>
                        舒张压
                        <span className="wellness-weight-input">
                          <input
                            aria-label="舒张压"
                            type="number"
                            min="30"
                            max="200"
                            step="1"
                            required
                            placeholder="例如 76"
                            value={secondaryValue}
                            onChange={(event) => setSecondaryValue(event.target.value)}
                          />
                          <span>mmHg</span>
                        </span>
                      </label>
                    ) : null}
                    <label>
                      测量时间
                      <input
                        type="datetime-local"
                        required
                        value={measuredAt}
                        onChange={(event) => setMeasuredAt(event.target.value)}
                      />
                    </label>
                    <label className="wellness-field-full">
                      备注（可选）
                      <input
                        maxLength={200}
                        placeholder="例如：晨起、运动前、同一台设备"
                        value={measurementNote}
                        onChange={(event) => setMeasurementNote(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      recordingMeasurement ||
                      !primaryValue ||
                      (selectedMetric === 'BLOOD_PRESSURE' && !secondaryValue)
                    }
                  >
                    {recordingMeasurement ? '记录中…' : `记录${selectedDefinition.label}`}
                  </button>
                </form>

                <div className="wellness-history-heading">
                  <div>
                    <span>最近记录</span>
                    <h3>{selectedDefinition.label}趋势</h3>
                  </div>
                  {selectedTrend ? <small>共 {selectedTrend.entries.length} 条</small> : null}
                </div>
                {selectedTrend?.entries.length ? (
                  <div className="wellness-measurement-history">
                    {selectedTrend.entries
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>
                              {entry.metric_type === 'BLOOD_PRESSURE' &&
                              entry.secondary_value != null
                                ? `${entry.value}/${entry.secondary_value}`
                                : entry.value}{' '}
                              {selectedDefinition.unit}
                            </strong>
                            <span>
                              {new Date(entry.measured_at).toLocaleString('zh-CN', {
                                timeZone: household.timezone,
                              })}
                              {entry.note ? ` · ${entry.note}` : ''}
                            </span>
                          </div>
                          <button
                            className="ghost"
                            type="button"
                            disabled={deletingMeasurementId === entry.id}
                            onClick={async () => {
                              setDeletingMeasurementId(entry.id);
                              setError('');
                              try {
                                await deleteBodyMeasurement(householdId, entry.id);
                                setMessage('这条身体指标记录已删除。');
                                await reload();
                              } catch (caught) {
                                setError(caught instanceof Error ? caught.message : '删除失败');
                              } finally {
                                setDeletingMeasurementId(null);
                              }
                            }}
                          >
                            {deletingMeasurementId === entry.id ? '删除中…' : '删除'}
                          </button>
                        </article>
                      ))}
                  </div>
                ) : (
                  <div className="wellness-empty">
                    还没有{selectedDefinition.label}记录。先添加一条，之后再观察长期变化。
                  </div>
                )}

                <div className="wellness-evidence-note">
                  <strong>记录边界</strong>
                  <p>
                    BMI 是筛查参考，不直接测量体脂；血压与心率记录不能替代医生判断。测量项目参考 WHO
                    STEPS 的常用身体指标。
                  </p>
                  <div>
                    <a
                      href="https://www.who.int/teams/noncommunicable-diseases/surveillance/systems-tools/steps"
                      target="_blank"
                      rel="noreferrer"
                    >
                      WHO STEPS
                    </a>
                    <a
                      href="https://www.cdc.gov/bmi/faq/index.html"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CDC BMI 说明
                    </a>
                  </div>
                </div>
              </div>
            ) : null}

            {activePanel === 'nutrition' ? (
              <div className="wellness-dialog-content">
                <div className="wellness-advice-basis">
                  <div>
                    <span>个人目标</span>
                    <strong>{goalLabel(profile.goal)}</strong>
                  </div>
                  <div>
                    <span>活动情况</span>
                    <strong>{activityLabel(profile.activity_level)}</strong>
                  </div>
                  <div>
                    <span>过敏原过滤</span>
                    <strong>{profile.allergen_codes.length} 项</strong>
                  </div>
                </div>
                {meals?.excluded_for_allergens.length ? (
                  <div className="wellness-allergen-note">
                    已强制排除：{meals.excluded_for_allergens.map((item) => item.name).join('、')}
                  </div>
                ) : null}
                {meals?.suggestions.length ? (
                  <div className="wellness-meal-list">
                    {meals.suggestions.slice(0, 6).map((recipe) => (
                      <article key={recipe.id}>
                        <div>
                          <strong>{recipe.name}</strong>
                          <p>{recipe.description}</p>
                        </div>
                        <span>库存覆盖 {Math.round(recipe.coverage * 100)}%</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="wellness-empty">
                    暂无合适候选。完善个人健康基础和家庭库存后，小知会替你整理可选餐食。
                  </div>
                )}
                {meals?.limitations.length ? (
                  <div className="wellness-evidence-note">
                    <strong>本次建议的局限</strong>
                    <ul className="wellness-limitations">
                      {meals.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activePanel === 'profile' ? (
              <form className="wellness-dialog-content" onSubmit={save}>
                <div className="wellness-form-grid">
                  <label>
                    出生年份
                    <input
                      type="number"
                      min="1900"
                      max="2100"
                      placeholder="例如 1990"
                      value={profile.birth_year ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          birth_year: event.target.value ? Number(event.target.value) : null,
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
                      placeholder="例如 168"
                      value={profile.height_cm ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          height_cm: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    当前目标
                    <select
                      value={profile.goal}
                      onChange={(event) =>
                        setProfile({ ...profile, goal: event.target.value as WellnessGoal })
                      }
                    >
                      {GOALS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    日常活动情况
                    <select
                      value={profile.activity_level}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          activity_level: event.target.value as ActivityLevel,
                        })
                      }
                    >
                      {ACTIVITY_LEVELS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="wellness-field-full wellness-allergens">
                    <legend>需要避开的过敏原</legend>
                    <div>
                      {ALLERGENS.map(([code, label]) => (
                        <label className="wellness-choice" key={code}>
                          <input
                            type="checkbox"
                            checked={profile.allergen_codes.includes(code)}
                            onChange={(event) =>
                              setProfile({
                                ...profile,
                                allergen_codes: event.target.checked
                                  ? [...profile.allergen_codes, code]
                                  : profile.allergen_codes.filter((item) => item !== code),
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="wellness-field-full">
                    饮食限制（用逗号分隔）
                    <input
                      placeholder="例如：素食、低盐"
                      value={profile.dietary_restrictions.join('，')}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          dietary_restrictions: event.target.value
                            .split(/[，,]/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="wellness-field-full">
                    希望系统留意的信息（自行填写，不作诊断）
                    <input
                      placeholder="例如：近期希望规律吃早餐"
                      value={profile.health_considerations.join('，')}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          health_considerations: event.target.value
                            .split(/[，,]/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="wellness-choice wellness-field-full wellness-share-choice">
                    <input
                      type="checkbox"
                      checked={profile.share_with_household}
                      onChange={(event) =>
                        setProfile({ ...profile, share_with_household: event.target.checked })
                      }
                    />
                    允许同一家庭成员查看此档案和身体指标记录
                  </label>
                </div>
                <div className="wellness-form-actions">
                  <button className="primary" type="submit" disabled={savingProfile}>
                    {savingProfile ? '保存中…' : '保存个人健康基础'}
                  </button>
                  <span>默认仅你自己可见；共享授权可随时关闭。</span>
                </div>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
