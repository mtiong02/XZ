'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import {
  apiGet,
  apiPost,
  fetchNutritionStructure,
  type FoodCategorySummary,
  type FoodSummary,
  type NutritionStructureView,
  type UnitSummary,
} from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

export default function FoodLibraryPage() {
  const { household, loading } = useHousehold();
  const [foods, setFoods] = useState<FoodSummary[]>([]);
  const [categories, setCategories] = useState<FoodCategorySummary[]>([]);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [nutrition, setNutrition] = useState<NutritionStructureView | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [defaultUnit, setDefaultUnit] = useState('');
  const [preferredUnits, setPreferredUnits] = useState<string[]>([]);
  const [shelfLife, setShelfLife] = useState('');
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (!household) return;
    const [nextFoods, nextCategories, nextUnits, nextNutrition] = await Promise.all([
      apiGet<FoodSummary[]>(`/households/${household.id}/foods`),
      apiGet<FoodCategorySummary[]>('/food-categories'),
      apiGet<UnitSummary[]>('/units'),
      fetchNutritionStructure(household.id),
    ]);
    setFoods(nextFoods);
    setCategories(nextCategories);
    setUnits(nextUnits);
    setNutrition(nextNutrition);
  };
  useEffect(() => {
    reload().catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [household]);

  const leaves = useMemo(() => {
    const parents = new Set(categories.map((category) => category.parent_code).filter(Boolean));
    return categories.filter((category) => !parents.has(category.code));
  }, [categories]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleFoods = useMemo(
    () =>
      foods.filter(
        (food) =>
          !normalizedSearch ||
          food.canonical_name.toLowerCase().includes(normalizedSearch) ||
          food.aliases.some((alias) => alias.toLowerCase().includes(normalizedSearch)),
      ),
    [foods, normalizedSearch],
  );

  function toggleUnit(code: string) {
    setPreferredUnits((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!household) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/households/${household.id}/foods`, {
        canonical_name: name,
        category_code: categoryCode,
        default_unit_code: defaultUnit,
        preferred_unit_codes: preferredUnits.length ? preferredUnits : [defaultUnit],
        default_shelf_life_days: shelfLife ? Number(shelfLife) : null,
        aliases: aliases
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setName('');
      setCategoryCode('');
      setDefaultUnit('');
      setPreferredUnits([]);
      setShelfLife('');
      setAliases('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }
  if (loading || !household) return <div className="empty">加载中…</div>;
  return (
    <>
      <AppHeader title="食材百科" subtitle="查找食材知识，也看看当前家庭库存的营养结构" />
      <main className="container workspace-page foods-page">
        <section className="knowledge-hero">
          <div className="workspace-hero-copy">
            <span>从家里现有的食材出发</span>
            <h2>家庭食材结构</h2>
            <p>基于当前在库食材做结构分析，不代表任何成员已经实际摄入，也不构成医疗或营养诊断。</p>
          </div>
          <div className="knowledge-group-grid">
            {nutrition?.groups
              .filter((group) =>
                ['PROTEIN', 'VEGETABLE', 'FRUIT', 'STAPLE', 'DAIRY', 'LEGUME'].includes(group.code),
              )
              .map((group) => (
                <div className={group.present ? '' : 'missing'} key={group.code}>
                  <span>{group.label}</span>
                  <strong>{group.present ? group.food_count : '—'}</strong>
                  <small>{group.present ? group.foods.join('、') : '暂未记录'}</small>
                </div>
              ))}
          </div>
          <div className="knowledge-observations">
            {nutrition?.observations.map((observation) => (
              <article key={observation.code}>
                <div>
                  <div className="name">{observation.title}</div>
                  <div className="qty">{observation.detail}</div>
                </div>
                <span className={`badge ${observation.severity === 'ATTENTION' ? 'warn' : 'safe'}`}>
                  {observation.severity === 'ATTENTION' ? '建议关注' : '分析结果'}
                </span>
              </article>
            ))}
          </div>
          {nutrition ? (
            <p className="knowledge-evidence">
              数据完整度：{Math.round(nutrition.evidence.profile_completeness * 100)}%（
              {nutrition.evidence.profiled_food_count} 种食材有营养资料，
              {nutrition.evidence.unprofiled_food_count} 种仅按分类分析）。
            </p>
          ) : null}
        </section>
        <section className="food-search-panel">
          <div>
            <span>标准食材百科</span>
            <h2>想了解什么食材？</h2>
            <p>搜索结果会同时用于库存录入、语音识别、分类、单位和保存规则。</p>
          </div>
          <label>
            <span className="visually-hidden">搜索食材百科</span>
            <input
              aria-label="搜索食材百科"
              value={search}
              placeholder="搜索食材或语音别名，例如：鲍鱼、虎虾、土豆"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>
        <section className="zone workspace-section">
          <details>
            <summary>找不到食材？新增家庭自定义食材</summary>
            <p className="qty" style={{ margin: '10px 0 16px' }}>
              只有标准百科中没有匹配时才需要填写；小知后续可以根据别名继续识别它。
            </p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="food-name">食材名称</label>
                <input
                  id="food-name"
                  required
                  value={name}
                  placeholder="例如：黑虎虾"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="food-category">具体分类</label>
                <select
                  id="food-category"
                  required
                  value={categoryCode}
                  onChange={(e) => setCategoryCode(e.target.value)}
                >
                  <option value="">请选择最具体分类</option>
                  {leaves.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name_path.join(' / ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="food-unit">默认单位</label>
                <select
                  id="food-unit"
                  required
                  value={defaultUnit}
                  onChange={(e) => {
                    setDefaultUnit(e.target.value);
                    setPreferredUnits((current) =>
                      current.includes(e.target.value) ? current : [...current, e.target.value],
                    );
                  }}
                >
                  <option value="">请选择</option>
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.name_zh}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>常用单位</label>
                <div className="unit-options">
                  {units.map((unit) => (
                    <label key={unit.code}>
                      <input
                        type="checkbox"
                        checked={preferredUnits.includes(unit.code)}
                        onChange={() => toggleUnit(unit.code)}
                      />{' '}
                      {unit.name_zh}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="food-shelf">默认保质期（天，可选）</label>
                <input
                  id="food-shelf"
                  type="number"
                  min="1"
                  max="3650"
                  value={shelfLife}
                  onChange={(e) => setShelfLife(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="food-aliases">语音别名（用逗号分隔）</label>
                <input
                  id="food-aliases"
                  value={aliases}
                  placeholder="例如：虎虾，大虾"
                  onChange={(e) => setAliases(e.target.value)}
                />
              </div>
              {error ? <div className="error-box">{error}</div> : null}
              <button className="primary" disabled={busy}>
                {busy ? '保存中…' : '保存食材'}
              </button>
            </form>
          </details>
        </section>
        <section className="zone workspace-section">
          <div className="workspace-section-heading">
            <div>
              <span>系统维护</span>
              <h2>标准食材知识库</h2>
            </div>
            <small>{visibleFoods.filter((food) => !food.is_custom).length} 种匹配</small>
          </div>
          <p className="qty">
            已收录 {foods.filter((food) => !food.is_custom).length}{' '}
            种标准食材；分类、别名、单位、保质期和来源均可追溯。
          </p>
          <div className="items">
            {visibleFoods
              .filter((food) => !food.is_custom)
              .slice(0, 24)
              .map((food) => (
                <div className="item-card" key={food.id}>
                  <div>
                    <div className="name">{food.canonical_name}</div>
                    <div className="qty">
                      {food.category_path?.slice(1).join(' / ') || '待分类'} · 默认{' '}
                      {food.default_unit_code}
                      {food.default_shelf_life_days
                        ? ` · 冷藏参考 ${food.default_shelf_life_days} 天`
                        : ''}
                      {food.aliases.length ? ` · 别名：${food.aliases.join('、')}` : ''}
                    </div>
                  </div>
                  <span className="badge safe">
                    {food.review_status === 'VERIFIED' ? '已核验' : '已整理'}
                  </span>
                </div>
              ))}
          </div>
        </section>
        <section className="zone workspace-section">
          <div className="workspace-section-heading">
            <div>
              <span>只属于这个家庭</span>
              <h2>我的自定义食材</h2>
            </div>
          </div>
          {foods.filter((food) => food.is_custom).length === 0 ? (
            <p className="empty">还没有自定义食材</p>
          ) : (
            <div className="items">
              {visibleFoods
                .filter((food) => food.is_custom)
                .map((food) => (
                  <div className="item-card" key={food.id}>
                    <div>
                      <div className="name">{food.canonical_name}</div>
                      <div className="qty">
                        {food.category_path?.slice(1).join(' / ') || '待分类'} · 默认{' '}
                        {food.default_unit_code}
                        {food.aliases.length ? ` · 别名：${food.aliases.join('、')}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
