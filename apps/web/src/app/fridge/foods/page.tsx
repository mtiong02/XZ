'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import { fetchNutritionStructure, type NutritionStructureView } from '../../../lib/api';
import { useHousehold } from '../../../lib/use-household';

export default function FoodLibraryPage() {
  const { household, loading } = useHousehold();
  const [nutrition, setNutrition] = useState<NutritionStructureView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!household) return;
    fetchNutritionStructure(household.id)
      .then((nextNutrition) => {
        setNutrition(nextNutrition);
        setError(null);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '加载食材指南失败'),
      );
  }, [household]);

  const groupCards = useMemo(() => {
    const groups = nutrition?.groups ?? [];
    const collect = (codes: string[]) => {
      const names = groups
        .filter((group) => codes.includes(group.code))
        .flatMap((group) => group.foods);
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
      </main>
    </>
  );
}
