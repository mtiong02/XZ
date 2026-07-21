'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addMissingRecipeItems,
  fetchMealSuggestions,
  fetchNutritionStructure,
  fetchShoppingList,
  updateShoppingItemStatus,
  type MealSuggestionView,
  type NutritionStructureView,
  type ShoppingListItemView,
} from '../../../lib/api';
import { unitLabel } from '../../../lib/format';
import { useHousehold } from '../../../lib/use-household';
import { AppHeader } from '../../../components/app-header';

export default function MealsPage() {
  const { household, loading } = useHousehold();
  const [recipes, setRecipes] = useState<MealSuggestionView[]>([]);
  const [shopping, setShopping] = useState<ShoppingListItemView[]>([]);
  const [nutrition, setNutrition] = useState<NutritionStructureView | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!household) return;
    try {
      const [nextRecipes, nextShopping, nextNutrition] = await Promise.all([
        fetchMealSuggestions(household.id),
        fetchShoppingList(household.id),
        fetchNutritionStructure(household.id),
      ]);
      setRecipes(nextRecipes);
      setShopping(nextShopping);
      setNutrition(nextNutrition);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败');
    }
  }, [household]);

  useEffect(() => void reload(), [reload]);
  if (loading || !household) return <div className="empty">加载中…</div>;

  return (
    <>
      <AppHeader title="餐食与购物清单" subtitle="优先利用现有食材，缺少的再加入清单" />
      <main className="container">
        <p className="sub" style={{ marginBottom: 16 }}>
          候选仅依据当前库存和临期状态；不会自动扣减库存，也不会向外部商家下单。
        </p>
        {error ? <div className="error-box">{error}</div> : null}
        {message ? <div className="success-box">{message}</div> : null}

        {nutrition ? (
          <section className="zone">
            <h2>从家庭结构出发</h2>
            <p className="qty">
              当前先优先利用库存中已有食材；以下建议只反映库存结构，不代表成员实际摄入。
            </p>
            <div className="items">
              {nutrition.observations
                .filter((observation) => observation.severity === 'ATTENTION')
                .slice(0, 2)
                .map((observation) => (
                  <div className="item-card" key={observation.code}>
                    <div>
                      <div className="name">{observation.title}</div>
                      <div className="qty">{observation.detail}</div>
                    </div>
                    <span className="badge warn">补充建议</span>
                  </div>
                ))}
            </div>
          </section>
        ) : null}

        <section className="zone">
          <h2>当前可选菜谱</h2>
          <div className="items">
            {recipes.map((recipe) => (
              <article className="item-card" key={recipe.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ width: '100%' }}>
                  <div className="name">{recipe.name}</div>
                  <div className="qty">
                    {recipe.description} · {recipe.servings} 人份
                  </div>
                  <div className="qty" style={{ marginTop: 6 }}>
                    {recipe.ingredients
                      .map(
                        (item) =>
                          `${item.available ? '✓' : '○'} ${item.food_name}${item.quantity ? ` ${item.quantity}${unitLabel(item.unit_code ?? '')}` : ''}`,
                      )
                      .join(' · ')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <span className={`badge ${recipe.can_make ? 'normal' : 'unknown'}`}>
                      {recipe.can_make
                        ? '现有食材可做'
                        : `库存覆盖 ${Math.round(recipe.coverage * 100)}%`}
                    </span>
                    {recipe.missing.length ? (
                      <button
                        className="primary"
                        onClick={async () => {
                          const result = (await addMissingRecipeItems(household.id, recipe.id)) as {
                            added_count: number;
                          };
                          setMessage(`已把 ${result.added_count} 项缺少食材加入购物清单。`);
                          await reload();
                        }}
                      >
                        加入缺料
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="zone">
          <h2>待购清单</h2>
          {shopping.length === 0 ? (
            <p className="empty">购物清单还是空的。</p>
          ) : (
            <div className="items">
              {shopping.map((item) => (
                <div className="item-card" key={item.id}>
                  <div>
                    <div className="name">{item.food_name}</div>
                    <div className="qty">
                      {item.quantity
                        ? `${item.quantity} ${unitLabel(item.unit_code ?? '')}`
                        : '数量待定'}
                      {item.recipe_name ? ` · 来自${item.recipe_name}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="primary"
                      onClick={async () => {
                        await updateShoppingItemStatus(household.id, item.id, 'PURCHASED');
                        await reload();
                      }}
                    >
                      已购买
                    </button>
                    <button
                      onClick={async () => {
                        await updateShoppingItemStatus(household.id, item.id, 'CANCELLED');
                        await reload();
                      }}
                    >
                      移除
                    </button>
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
