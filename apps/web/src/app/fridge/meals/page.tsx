'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addMissingRecipeItems,
  fetchMealSuggestions,
  fetchPersonalizedMealRecommendation,
  fetchNutritionStructure,
  fetchShoppingList,
  markShoppingItemPurchased,
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
  const [focusFood, setFocusFood] = useState<{ id: string; name: string } | null>(null);
  const [servingsFilter, setServingsFilter] = useState<number | null>(null);
  const [agentRecommendation, setAgentRecommendation] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [purchasingItemId, setPurchasingItemId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('food');
    const name = params.get('name');
    setFocusFood(id && name ? { id, name } : null);
  }, []);

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
  useEffect(() => {
    if (!household || !focusFood) return;
    setAgentBusy(true);
    setAgentRecommendation('');
    fetchPersonalizedMealRecommendation(
      household.id,
      `请结合我们家当前库存、我的偏好和健康目标，优先用${focusFood.name}安排一份合适的餐食。不要重复最近推荐过的菜。`,
    )
      .then((result) => setAgentRecommendation(result.text))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '小知暂时无法生成餐食建议'),
      )
      .finally(() => setAgentBusy(false));
  }, [focusFood, household]);
  if (loading || !household) return <div className="empty">加载中…</div>;
  const makeableCount = recipes.filter((recipe) => recipe.can_make).length;
  const scopedRecipes = useMemo(
    () =>
      focusFood
        ? recipes.filter((recipe) =>
            recipe.ingredients.some((ingredient) => ingredient.food_id === focusFood.id),
          )
        : recipes,
    [focusFood, recipes],
  );
  const servingOptions = useMemo(() => {
    const common = [1, 2, 3, 4, 5, 6];
    return [...new Set([...common, ...scopedRecipes.map((recipe) => recipe.servings)])]
      .filter((servings) => Number.isFinite(servings) && servings > 0)
      .sort((a, b) => a - b);
  }, [scopedRecipes]);
  const visibleRecipes = useMemo(
    () =>
      servingsFilter === null
        ? scopedRecipes
        : scopedRecipes.filter((recipe) => recipe.servings === servingsFilter),
    [scopedRecipes, servingsFilter],
  );
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
        {focusFood ? (
          <section className="meal-food-focus">
            <div>
              <span>从食材指南带入</span>
              <strong>优先查看使用“{focusFood.name}”的餐食</strong>
            </div>
            <Link href="/fridge/meals">查看全部餐食</Link>
          </section>
        ) : null}
        {focusFood ? (
          <section className="zone workspace-section meal-agent-card">
            <div className="workspace-section-heading">
              <div>
                <span>小知个性化建议</span>
                <h2>用{focusFood.name}安排这一餐</h2>
              </div>
              <small>{agentBusy ? '正在结合家庭情况分析…' : '已结合库存与个人档案'}</small>
            </div>
            <p>{agentBusy ? '小知正在想一个更适合你们家的方案。' : agentRecommendation}</p>
          </section>
        ) : null}

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
            <div className="meal-quick-filters" aria-label="按用餐人数筛选餐食">
              <span>快速筛选 · 几人餐</span>
              <div className="quick-choice-row">
                <button
                  type="button"
                  className={servingsFilter === null ? 'selected' : ''}
                  aria-pressed={servingsFilter === null}
                  onClick={() => setServingsFilter(null)}
                >
                  全部 <small>{scopedRecipes.length}</small>
                </button>
                {servingOptions.map((servings) => {
                  const count = scopedRecipes.filter(
                    (recipe) => recipe.servings === servings,
                  ).length;
                  return (
                    <button
                      type="button"
                      className={servingsFilter === servings ? 'selected' : ''}
                      aria-pressed={servingsFilter === servings}
                      disabled={count === 0}
                      key={servings}
                      onClick={() => setServingsFilter(servings)}
                    >
                      {servings}人 <small>{count}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="meal-recipe-list">
              {visibleRecipes.length === 0 ? (
                <p className="empty workspace-empty">
                  {focusFood
                    ? `当前菜谱中还没有使用${focusFood.name}的合适候选。`
                    : '暂无餐食候选，添加冰箱食材后，小知会结合库存为你推荐。'}
                </p>
              ) : (
                visibleRecipes.map((recipe) => (
                  <article className="meal-recipe-card" key={recipe.id}>
                    <div className="meal-recipe-copy">
                      <div className="name">{recipe.name}</div>
                      <div className="qty">
                        {recipe.description} · {recipe.servings} 人份
                      </div>
                      <div className="meal-ingredients">
                        {recipe.ingredients.map((item) => (
                          <Link
                            className={item.available ? 'available' : ''}
                            href={`/fridge/foods?q=${encodeURIComponent(item.food_name)}`}
                            key={item.food_id}
                          >
                            {item.available ? '已有' : '缺少'} · {item.food_name}
                            {item.quantity
                              ? ` ${item.quantity}${unitLabel(item.unit_code ?? '')}`
                              : ''}
                          </Link>
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
                        disabled={purchasingItemId === item.id}
                        onClick={async () => {
                          setPurchasingItemId(item.id);
                          setError('');
                          try {
                            await markShoppingItemPurchased(household.id, item.id);
                            setMessage(`已购买并加入库存：${item.food_name}`);
                            await reload();
                          } catch (caught) {
                            setError(caught instanceof Error ? caught.message : '标记购买失败');
                          } finally {
                            setPurchasingItemId(null);
                          }
                        }}
                      >
                        {purchasingItemId === item.id ? '正在入库…' : '已购买'}
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
