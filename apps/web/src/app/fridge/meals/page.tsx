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
  const [addingRecipeId, setAddingRecipeId] = useState<string | null>(null);

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
  const makeableCount = recipes.filter((recipe) => recipe.can_make).length;
  const attentionObservations =
    nutrition?.observations
      .filter((observation) => observation.severity === 'ATTENTION')
      .slice(0, 2) ?? [];

  return (
    <>
      <AppHeader title="餐食与购物清单" subtitle="优先利用现有食材，缺少的再加入清单" />
      <main className="container workspace-page meals-page">
        {error ? <div className="error-box">{error}</div> : null}
        {message ? <div className="success-box">{message}</div> : null}

        <section className="workspace-hero workspace-hero-compact meal-hero">
          <div className="workspace-hero-copy">
            <span>先看看家里能做什么</span>
            <h2>
              {makeableCount > 0
                ? `已有 ${makeableCount} 道菜可以直接准备`
                : '从库存出发安排下一餐'}
            </h2>
            <p>候选只依据当前库存、临期状态和已确认限制，不自动扣减库存，也不会代你下单。</p>
          </div>
          <div className="workspace-summary-grid">
            <div>
              <strong>{recipes.length}</strong>
              <span>餐食候选</span>
            </div>
            <div>
              <strong>{makeableCount}</strong>
              <span>现在可做</span>
            </div>
            <div className={shopping.length > 0 ? 'attention' : ''}>
              <strong>{shopping.length}</strong>
              <span>待购食材</span>
            </div>
          </div>
          {attentionObservations.length > 0 ? (
            <div className="meal-attention-strip">
              {attentionObservations.map((observation) => (
                <div key={observation.code}>
                  <strong>{observation.title}</strong>
                  <span>{observation.detail}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <div className="workspace-layout meal-layout">
          <section className="zone workspace-section meal-recipes">
            <div className="workspace-section-heading">
              <div>
                <span>结合现有食材</span>
                <h2>餐食候选</h2>
              </div>
              <small>优先展示库存覆盖高的方案</small>
            </div>
            <div className="meal-recipe-list">
              {recipes.length === 0 ? (
                <p className="empty workspace-empty">暂无餐食候选，添加冰箱食材或自定义菜谱后，小知会为你智能推荐。</p>
              ) : (
                recipes.map((recipe) => (
                  <article className="meal-recipe-card" key={recipe.id}>
                    <div className="meal-recipe-copy">
                      <div className="name">{recipe.name}</div>
                      <div className="qty">
                        {recipe.description} · {recipe.servings} 人份
                      </div>
                      <div className="meal-ingredients">
                        {recipe.ingredients.map((item) => (
                          <span className={item.available ? 'available' : ''} key={item.food_id}>
                            {item.available ? '已有' : '缺少'} · {item.food_name}
                            {item.quantity
                              ? ` ${item.quantity}${unitLabel(item.unit_code ?? '')}`
                              : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="meal-recipe-actions">
                      <span className={`badge ${recipe.can_make ? 'normal' : 'unknown'}`}>
                        {recipe.can_make
                          ? '现有食材可做'
                          : `库存覆盖 ${Math.round(recipe.coverage * 100)}%`}
                      </span>
                      {recipe.missing.length ? (
                        <button
                          className="primary"
                          disabled={addingRecipeId === recipe.id}
                          onClick={async () => {
                            setAddingRecipeId(recipe.id);
                            setMessage('');
                            try {
                              const result = await addMissingRecipeItems(household.id, recipe.id);
                              const nextShopping = await fetchShoppingList(household.id);
                              const visibleIds = new Set(nextShopping.map((item) => item.id));
                              const visibleCount = result.items.filter((item) =>
                                visibleIds.has(item.id),
                              ).length;
                              if (visibleCount !== result.items.length) {
                                throw new Error('购物清单尚未同步完成，请稍后重试。');
                              }
                              setShopping(nextShopping);
                              setMessage(`已把 ${visibleCount} 项缺少食材放入待购清单。`);
                              setError('');
                            } catch (caught) {
                              setError(caught instanceof Error ? caught.message : '加入缺料失败');
                            } finally {
                              setAddingRecipeId(null);
                            }
                          }}
                        >
                          {addingRecipeId === recipe.id ? '加入中…' : '加入缺料'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="zone workspace-section meal-shopping">
            <div className="workspace-section-heading">
              <div>
                <span>只放确认要买的东西</span>
                <h2>待购清单</h2>
              </div>
              <small>{shopping.length} 项</small>
            </div>
            {shopping.length === 0 ? (
              <p className="empty workspace-empty">购物清单还是空的。</p>
            ) : (
              <div className="workspace-card-list">
                {shopping.map((item) => (
                  <article className="workspace-card workspace-card-stack" key={item.id}>
                    <div>
                      <div className="name">{item.food_name}</div>
                      <div className="qty">
                        {item.quantity
                          ? `${item.quantity} ${unitLabel(item.unit_code ?? '')}`
                          : '数量待定'}
                        {item.recipe_name ? ` · 来自${item.recipe_name}` : ''}
                      </div>
                    </div>
                    <div className="workspace-card-actions">
                      <button
                        className="primary"
                        onClick={async () => {
                          await updateShoppingItemStatus(household.id, item.id, 'PURCHASED');
                          setMessage('');
                          await reload();
                        }}
                      >
                        已购买
                      </button>
                      <button
                        onClick={async () => {
                          await updateShoppingItemStatus(household.id, item.id, 'CANCELLED');
                          setMessage('');
                          await reload();
                        }}
                      >
                        移除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
