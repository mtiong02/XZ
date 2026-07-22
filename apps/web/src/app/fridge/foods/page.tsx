'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import {
  apiGet,
  fetchInventory,
  fetchNutritionStructure,
  type FoodSummary,
  type NutritionStructureView,
} from '../../../lib/api';
import { unitLabel } from '../../../lib/format';
import { useHousehold } from '../../../lib/use-household';
import type { InventoryView } from '@xz/contracts';

const ZONE_LABELS = { PANTRY: '常温', FRIDGE: '冷藏', FREEZER: '冷冻' } as const;
const ALLERGEN_LABELS: Record<string, string> = {
  MILK: '乳制品', EGG: '蛋类', FISH: '鱼类', CRUSTACEAN: '甲壳类', MOLLUSK: '软体动物',
  SOY: '大豆', PEANUT: '花生', TREE_NUT: '坚果', SESAME: '芝麻', GLUTEN: '含麸质谷物',
};
const INTERNAL_CATEGORY_NAMES = new Set(['食材', '动物性食材', '植物性食材']);

export default function FoodLibraryPage() {
  const { household, loading } = useHousehold();
  const [foods, setFoods] = useState<FoodSummary[]>([]);
  const [inventory, setInventory] = useState<InventoryView | null>(null);
  const [nutrition, setNutrition] = useState<NutritionStructureView | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearch(new URLSearchParams(window.location.search).get('q') ?? '');
  }, []);
  useEffect(() => {
    if (!household) return;
    Promise.all([
      apiGet<FoodSummary[]>(`/households/${household.id}/foods`),
      fetchInventory(household.id),
      fetchNutritionStructure(household.id),
    ])
      .then(([nextFoods, nextInventory, nextNutrition]) => {
        setFoods(nextFoods);
        setInventory(nextInventory);
        setNutrition(nextNutrition);
        setError(null);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '加载食材指南失败'),
      );
  }, [household]);

  const inventoryByFood = useMemo(
    () =>
      new Map(
        (inventory?.zones ?? []).flatMap((zone) =>
          zone.items.map((item) => [item.food_id, { ...item, zone_name: zone.name }] as const),
        ),
      ),
    [inventory],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const visibleFoods = useMemo(() => {
    if (!normalizedSearch) return foods.filter((food) => inventoryByFood.has(food.id));
    return foods.filter(
      (food) =>
        food.canonical_name.toLowerCase().includes(normalizedSearch) ||
        food.aliases.some((alias) => alias.toLowerCase().includes(normalizedSearch)),
    );
  }, [foods, inventoryByFood, normalizedSearch]);

  const groupCards = useMemo(() => {
    const groups = nutrition?.groups ?? [];
    const collect = (codes: string[]) => {
      const names = groups.filter((group) => codes.includes(group.code)).flatMap((group) => group.foods);
      return [...new Set(names)];
    };
    return [
      { label: '谷薯与主食', foods: collect(['STAPLE']) },
      { label: '蔬菜', foods: collect(['VEGETABLE']) },
      { label: '水果', foods: collect(['FRUIT']) },
      { label: '肉禽鱼蛋', foods: collect(['PROTEIN', 'SEAFOOD']) },
      { label: '奶类', foods: collect(['DAIRY']) },
      { label: '豆类与坚果', foods: collect(['LEGUME', 'HEALTHY_FAT']) },
    ];
  }, [nutrition]);

  if (loading || !household) return <div className="empty">加载中…</div>;
  return (
    <>
      <AppHeader title="食材指南" subtitle="看懂家里的食材，也把合适的食材带进下一餐" />
      <main className="container workspace-page foods-page">
        {error ? <div className="error-box">{error}</div> : null}
        <section className="knowledge-hero">
          <div className="workspace-hero-copy">
            <span>基于当前库存</span>
            <h2>家里的食材多样性</h2>
            <p>这里只看家里现在有哪些类别，不等于实际吃了多少，也不代替个人营养评估。</p>
            <small className="knowledge-method-note">
              分组参考中国居民平衡膳食宝塔，库存只用于发现类别缺口。
            </small>
          </div>
          <div className="knowledge-group-grid">
            {groupCards.map((group) => (
              <div className={group.foods.length ? '' : 'missing'} key={group.label}>
                <span>{group.label}</span>
                <strong>{group.foods.length || '—'}</strong>
                <small>{group.foods.length ? group.foods.join('、') : '暂未记录'}</small>
              </div>
            ))}
          </div>
          <div className="knowledge-observations">
            {nutrition?.observations.slice(0, 3).map((observation) => (
              <article key={observation.code}>
                <div>
                  <div className="name">{observation.title}</div>
                  <div className="qty">{observation.detail}</div>
                </div>
                <span className={`badge ${observation.severity === 'ATTENTION' ? 'warn' : 'safe'}`}>
                  {observation.severity === 'ATTENTION' ? '可以改善' : '当前情况'}
                </span>
              </article>
            ))}
          </div>
          <Link className="knowledge-meal-link" href="/fridge/meals">
            按这些食材安排下一餐
          </Link>
        </section>

        <section className="food-search-panel">
          <div>
            <span>食材指南</span>
            <h2>{normalizedSearch ? '搜索结果' : '了解家里现有的食材'}</h2>
            <p>查看分类、保存建议、过敏原和已核验营养资料；搜索不会改变库存。</p>
          </div>
          <label>
            <span className="visually-hidden">搜索食材指南</span>
            <input
              aria-label="搜索食材指南"
              value={search}
              placeholder="搜索食材，例如：鲍鱼、土豆、牛奶"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>

        <section className="food-guide-grid" aria-live="polite">
          {visibleFoods.length === 0 ? (
            <div className="zone workspace-section workspace-empty">
              {normalizedSearch ? '暂时没有找到这项食材。' : '库存里还没有可展示的食材。'}
            </div>
          ) : (
            visibleFoods.map((food) => {
              const stock = inventoryByFood.get(food.id);
              const category = (food.category_path ?? [])
                .filter((name) => !INTERNAL_CATEGORY_NAMES.has(name))
                .join(' / ');
              const nutritionProfile = food.nutrition_profile;
              return (
                <article className="zone workspace-section food-guide-card" key={food.id}>
                  <div className="food-guide-heading">
                    <div>
                      <span>{category || '其他食材'}</span>
                      <h2>{food.canonical_name}</h2>
                    </div>
                    <span className={`badge ${stock ? 'safe' : 'unknown'}`}>
                      {stock
                        ? `${stock.zone_name}有 ${stock.total_quantity}${unitLabel(stock.unit)}`
                        : '家里暂未记录'}
                    </span>
                  </div>

                  {food.shelf_life_rules?.length ? (
                    <div className="food-guide-block">
                      <strong>怎么保存</strong>
                      <div className="food-guide-tags">
                        {food.shelf_life_rules.map((rule) => (
                          <span key={rule.storage_zone_code}>
                            {ZONE_LABELS[rule.storage_zone_code]}参考 {rule.min_days ? `${rule.min_days}–` : ''}
                            {rule.max_days} 天{rule.condition_note ? ` · ${rule.condition_note}` : ''}
                          </span>
                        ))}
                      </div>
                      <small>包装标签、购买日期和实际状态始终优先于通用参考。</small>
                    </div>
                  ) : (
                    <div className="food-guide-block muted">暂无可靠的分区保存资料，请优先看包装标签。</div>
                  )}

                  <div className="food-guide-block">
                    <strong>过敏原提示</strong>
                    <p>
                      {food.allergen_codes?.length
                        ? food.allergen_codes.map((code) => ALLERGEN_LABELS[code] ?? code).join('、')
                        : '目录中暂无常见强制过敏原标记；个体不耐受仍需自行留意。'}
                    </p>
                  </div>

                  <div className="food-guide-block">
                    <strong>营养资料</strong>
                    {nutritionProfile ? (
                      <p>
                        每 {nutritionProfile.basis_quantity}{unitLabel(nutritionProfile.basis_unit_code)}：
                        {nutritionProfile.energy_kcal ? `能量 ${nutritionProfile.energy_kcal} 千卡` : ''}
                        {nutritionProfile.protein_g ? ` · 蛋白质 ${nutritionProfile.protein_g} 克` : ''}
                        {nutritionProfile.fat_g ? ` · 脂肪 ${nutritionProfile.fat_g} 克` : ''}
                        {nutritionProfile.carbohydrate_g ? ` · 碳水 ${nutritionProfile.carbohydrate_g} 克` : ''}
                        {nutritionProfile.fiber_g ? ` · 膳食纤维 ${nutritionProfile.fiber_g} 克` : ''}
                        <small> 来源：{nutritionProfile.source_name}</small>
                      </p>
                    ) : (
                      <p className="muted">暂无已核验的营养数值，因此不展示估算热量。</p>
                    )}
                  </div>

                  <Link
                    className="primary food-guide-action"
                    href={`/fridge/meals?food=${encodeURIComponent(food.id)}&name=${encodeURIComponent(food.canonical_name)}`}
                  >
                    用{food.canonical_name}安排餐食
                  </Link>
                </article>
              );
            })
          )}
        </section>
      </main>
    </>
  );
}
