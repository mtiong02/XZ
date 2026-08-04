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
import { getTts } from '../../../lib/tts';
import { useHousehold } from '../../../lib/use-household';
import { AppHeader } from '../../../components/app-header';

type GroceryPlatform = 'JD' | 'HEMA' | 'DINGDONG' | 'MEITUAN';

const groceryPlatforms: Array<{
  id: GroceryPlatform;
  name: string;
  description: string;
  androidPackage: string;
}> = [
  {
    id: 'JD',
    name: '京东',
    description: '京东超市 / 京东秒送',
    androidPackage: 'com.jingdong.app.mall',
  },
  { id: 'HEMA', name: '盒马', description: '盒马鲜生', androidPackage: 'com.wudaokou.hippo' },
  {
    id: 'DINGDONG',
    name: '叮咚买菜',
    description: '附近生鲜配送',
    androidPackage: 'com.yaya.zone',
  },
  {
    id: 'MEITUAN',
    name: '美团买菜',
    description: '美团闪购 / 买菜',
    androidPackage: 'com.baobaoaichi.imaicai',
  },
];

function foodShoppingWebUrl(platform: GroceryPlatform, foodName: string) {
  const keyword = encodeURIComponent(foodName);

  switch (platform) {
    case 'JD':
      return `https://search.jd.com/Search?keyword=${keyword}`;
    case 'HEMA':
      return 'https://www.hema.com/';
    case 'DINGDONG':
      return 'https://www.dingdongxiaoqu.com/';
    case 'MEITUAN':
      return `https://www.meituan.com/search?query=${keyword}`;
  }
}

function foodShoppingAppUrl(platform: GroceryPlatform, foodName: string) {
  const keyword = encodeURIComponent(foodName);

  switch (platform) {
    case 'JD':
      return `openapp.jdmobile://virtual?params=${encodeURIComponent(
        JSON.stringify({ category: 'jump', des: 'productList', keyWord: foodName, from: 'search' }),
      )}`;
    case 'HEMA':
      return `freshhema://search?keyword=${keyword}`;
    case 'DINGDONG':
      return `ddmc://search?keyword=${keyword}`;
    case 'MEITUAN':
      return `imeituan://www.meituan.com/search?q=${keyword}`;
  }
}

function androidIntentUrl(platform: GroceryPlatform, foodName: string) {
  const target = groceryPlatforms.find((candidate) => candidate.id === platform);
  const appUrl = foodShoppingAppUrl(platform, foodName);
  const [scheme, path = ''] = appUrl.split('://');
  const fallback = encodeURIComponent(foodShoppingWebUrl(platform, foodName));
  return `intent://${path}#Intent;scheme=${scheme};package=${target?.androidPackage};S.browser_fallback_url=${fallback};end`;
}

function isMobileBrowser() {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isWechatBrowser() {
  return /micromessenger/i.test(navigator.userAgent);
}

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
  const [showMakeableOnly, setShowMakeableOnly] = useState(false);
  const [agentRecommendation, setAgentRecommendation] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [purchasingItemId, setPurchasingItemId] = useState<string | null>(null);
  const [selectedShoppingIds, setSelectedShoppingIds] = useState<Set<string>>(new Set());
  const [purchaseItems, setPurchaseItems] = useState<ShoppingListItemView[] | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tutorialRecipe, setTutorialRecipe] = useState<MealSuggestionView | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [kitchenModeActive, setKitchenModeActive] = useState(false);
  const [kitchenCurrentStep, setKitchenCurrentStep] = useState(0);
  const [kitchenTimer, setKitchenTimer] = useState<number | null>(null);
  const [kitchenTimerActive, setKitchenTimerActive] = useState(false);

  // 厨房模式倒计时器
  useEffect(() => {
    if (!kitchenTimerActive || kitchenTimer === null || kitchenTimer <= 0) return;
    const interval = setInterval(() => {
      setKitchenTimer((prev) => {
        if (prev === null || prev <= 1) {
          setKitchenTimerActive(false);
          try {
            if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
          } catch {
            // vibration API fallback
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [kitchenTimerActive, kitchenTimer]);

  // 厨房实操模式下自动锁定屏幕常亮，防止下厨过程中熄屏 (Screen Wake Lock API)
  useEffect(() => {
    if (!kitchenModeActive) return;
    let wakeLock: unknown = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Wake Lock API fallback
      }
    };
    void requestWakeLock();
    return () => {
      if (wakeLock && typeof (wakeLock as any).release === 'function') {
        void (wakeLock as any).release();
      }
    };
  }, [kitchenModeActive]);

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
      setSelectedShoppingIds(
        (current) =>
          new Set([...current].filter((id) => nextShopping.some((item) => item.id === id))),
      );
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
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const recipe of scopedRecipes) {
      for (const tag of recipe.tags || []) set.add(tag);
    }
    return Array.from(set).sort();
  }, [scopedRecipes]);

  const visibleRecipes = useMemo(
    () =>
      scopedRecipes.filter((recipe) => {
        const matchesServings = servingsFilter === null || recipe.servings === servingsFilter;
        const matchesMakeable = !showMakeableOnly || recipe.can_make;
        const matchesTag = selectedTag === null || (recipe.tags || []).includes(selectedTag);
        const matchesKeyword =
          !searchKeyword.trim() ||
          recipe.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          recipe.description.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          (recipe.tags || []).some((t) => t.toLowerCase().includes(searchKeyword.toLowerCase())) ||
          recipe.ingredients.some((i) =>
            i.food_name.toLowerCase().includes(searchKeyword.toLowerCase()),
          );
        return matchesServings && matchesMakeable && matchesTag && matchesKeyword;
      }),
    [scopedRecipes, servingsFilter, showMakeableOnly, selectedTag, searchKeyword],
  );
  const attentionObservations =
    nutrition?.observations
      .filter((observation) => observation.severity === 'ATTENTION')
      .slice(0, 2) ?? [];
  const selectedShoppingItems = shopping.filter((item) => selectedShoppingIds.has(item.id));
  const firstPurchaseItem = purchaseItems?.[0] ?? null;

  const closePurchaseDialog = () => {
    setPurchaseItems(null);
    setPurchaseStatus('');
  };

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openGroceryPlatform = async (platform: GroceryPlatform, items: ShoppingListItemView[]) => {
    const foodName = items[0]?.food_name ?? '食材';
    const isBatchPurchase = items.length > 1;
    const searchKeyword = isBatchPurchase
      ? items.map((item) => item.food_name).join(' ')
      : foodName;
    const shoppingText = items
      .map((item, index) => {
        const quantity = item.quantity
          ? `${item.quantity} ${unitLabel(item.unit_code ?? '')}`
          : '数量待定';
        return `${index + 1}. ${item.food_name} · ${quantity}`;
      })
      .join('\n');
    const name =
      groceryPlatforms.find((candidate) => candidate.id === platform)?.name ?? '购物平台';
    const webUrl = foodShoppingWebUrl(platform, searchKeyword);

    if (isBatchPurchase) {
      try {
        await navigator.clipboard?.writeText(`鲜知待购清单\n${shoppingText}`);
      } catch {
        // Clipboard access is optional; the dialog keeps the selection visible until navigation begins.
      }
    }

    if (isWechatBrowser()) {
      try {
        await navigator.clipboard?.writeText(foodName);
      } catch {
        // Clipboard access is not guaranteed in embedded browsers. The visible food name remains usable.
      }
      setPurchaseStatus(
        `微信内无法稳定唤起${name}。已尝试复制${isBatchPurchase ? `${items.length} 项采购清单` : `“${foodName}”`}，请点右上角“…”后选择在浏览器打开。`,
      );
      return;
    }

    if (!isMobileBrowser()) {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
      setPurchaseStatus(
        isBatchPurchase
          ? `已复制 ${items.length} 项采购清单，并在新标签页打开${name}。`
          : `已在新标签页打开${name}搜索。`,
      );
      return;
    }

    const appUrl = /android/i.test(navigator.userAgent)
      ? androidIntentUrl(platform, searchKeyword)
      : foodShoppingAppUrl(platform, searchKeyword);
    let appOpened = document.hidden;
    const markAppOpened = () => {
      appOpened = true;
    };
    document.addEventListener('visibilitychange', markAppOpened, { once: true });
    window.addEventListener('pagehide', markAppOpened, { once: true });
    setPurchaseStatus(
      isBatchPurchase
        ? `正在打开${name}，已带入 ${items.length} 项食材关键词；完整采购清单也已复制。`
        : `正在打开${name}并搜索“${foodName}”…`,
    );
    window.location.href = appUrl;

    window.setTimeout(() => {
      if (!appOpened && !document.hidden) {
        window.location.href = webUrl;
      }
    }, 1600);
  };

  if (loading || !household) return <div className="empty">加载中…</div>;

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
          <div className="workspace-summary-grid meal-summary-grid">
            <button
              type="button"
              onClick={() => {
                setShowMakeableOnly(false);
                jumpTo('meal-candidates');
              }}
            >
              <strong>{recipes.length}</strong>
              <span>餐食候选</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMakeableOnly(true);
                jumpTo('meal-candidates');
              }}
            >
              <strong>{makeableCount}</strong>
              <span>现在可做</span>
            </button>
            <button
              className={shopping.length > 0 ? 'attention' : ''}
              type="button"
              onClick={() => jumpTo('meal-shopping')}
            >
              <strong>{shopping.length}</strong>
              <span>待购食材</span>
            </button>
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
          <section className="zone workspace-section meal-recipes" id="meal-candidates">
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
                  onClick={() => {
                    setServingsFilter(null);
                    setShowMakeableOnly(false);
                  }}
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
                      onClick={() => {
                        setServingsFilter(servings);
                        setShowMakeableOnly(false);
                      }}
                    >
                      {servings}人 <small>{count}</small>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="meal-search-and-tags">
              <input
                type="search"
                className="meal-search-input"
                placeholder="搜索菜谱名、食材或标签（如：鸡胸肉、川菜、减脂）…"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
              />
              {allTags.length > 0 ? (
                <div className="meal-tag-pills">
                  <button
                    type="button"
                    className={`tag-pill ${selectedTag === null ? 'active' : ''}`}
                    onClick={() => setSelectedTag(null)}
                  >
                    全部标签
                  </button>
                  {allTags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      className={`tag-pill ${selectedTag === tag ? 'active' : ''}`}
                      onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
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
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setTutorialRecipe(recipe);
                          setCompletedSteps(new Set());
                        }}
                      >
                        查看制作教程
                      </button>
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

          <section className="zone workspace-section meal-shopping" id="meal-shopping">
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
              <>
                <div className="shopping-batch-toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        shopping.length > 0 && selectedShoppingItems.length === shopping.length
                      }
                      onChange={(event) =>
                        setSelectedShoppingIds(
                          event.target.checked
                            ? new Set(shopping.map((item) => item.id))
                            : new Set(),
                        )
                      }
                    />
                    全选
                  </label>
                  <span>已选 {selectedShoppingItems.length} 项</span>
                  <button
                    className="primary"
                    type="button"
                    disabled={selectedShoppingItems.length === 0}
                    onClick={() => setPurchaseItems(selectedShoppingItems)}
                  >
                    批量去购买
                  </button>
                </div>
                <div className="workspace-card-list">
                  {shopping.map((item) => (
                    <article className="workspace-card workspace-card-stack" key={item.id}>
                      <div className="shopping-card-title-row">
                        <label className="shopping-select-item">
                          <input
                            type="checkbox"
                            checked={selectedShoppingIds.has(item.id)}
                            onChange={(event) =>
                              setSelectedShoppingIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              })
                            }
                          />
                          <span className="name">{item.food_name}</span>
                        </label>
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
                          type="button"
                          onClick={() => setPurchaseItems([item])}
                        >
                          去购买
                        </button>
                        <button
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
              </>
            )}
          </section>
        </div>
      </main>
      {purchaseItems?.length ? (
        <div className="grocery-platform-backdrop" onClick={closePurchaseDialog}>
          <section
            className="grocery-platform-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="grocery-platform-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grocery-platform-dialog-header">
              <div>
                <span>前往购买</span>
                <h2 id="grocery-platform-title">
                  {purchaseItems.length === 1 && firstPurchaseItem
                    ? `购买${firstPurchaseItem.food_name}`
                    : `购买 ${purchaseItems.length} 项食材`}
                </h2>
                <p>
                  {purchaseItems.length === 1 && firstPurchaseItem
                    ? `选择常用平台，小知会带上“${firstPurchaseItem.food_name}”直接搜索。`
                    : '先确认本次采购清单，再选择一次常用平台。'}
                </p>
              </div>
              <button
                className="grocery-platform-close"
                type="button"
                aria-label="关闭购买平台选择"
                onClick={closePurchaseDialog}
              >
                关闭
              </button>
            </div>
            <div className="grocery-platform-options">
              {groceryPlatforms.map((platform) => (
                <button
                  type="button"
                  className="grocery-platform-option"
                  key={platform.id}
                  onClick={() => void openGroceryPlatform(platform.id, purchaseItems)}
                >
                  <strong>{platform.name}</strong>
                  <span>{platform.description}</span>
                  <small>
                    {purchaseItems.length === 1 && firstPurchaseItem
                      ? `搜索${firstPurchaseItem.food_name}`
                      : `购买已选 ${purchaseItems.length} 项`}
                  </small>
                </button>
              ))}
            </div>
            {purchaseStatus ? (
              <p className="grocery-platform-status" role="status" aria-live="polite">
                {purchaseStatus}
              </p>
            ) : null}
            <p className="grocery-platform-note">
              {purchaseItems.length === 1
                ? '手机会优先尝试打开已安装的 App；未安装或跳转失败时会自动进入平台网页。'
                : '会先复制完整采购清单，再打开所选平台；平台暂未授权跨食材直接写入购物车，因此请在平台内粘贴清单并确认商品。'}
              实际商品、价格与配送范围以平台显示为准。
            </p>
          </section>
        </div>
      ) : null}

      {tutorialRecipe ? (
        <div className="grocery-platform-backdrop" onClick={() => setTutorialRecipe(null)}>
          <section
            className="grocery-platform-dialog recipe-tutorial-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grocery-platform-dialog-header">
              <div>
                <div className="tutorial-header-badges">
                  <span className={`badge ${tutorialRecipe.can_make ? 'normal' : 'unknown'}`}>
                    {tutorialRecipe.can_make
                      ? '现有食材可做'
                      : `库存覆盖 ${Math.round(tutorialRecipe.coverage * 100)}%`}
                  </span>
                  {tutorialRecipe.tags?.map((t) => (
                    <span key={t} className="tutorial-tag-chip">
                      #{t}
                    </span>
                  ))}
                </div>
                <h2 id="tutorial-dialog-title">{tutorialRecipe.name}</h2>
                <p>
                  {tutorialRecipe.description} · {tutorialRecipe.servings} 人份
                </p>
              </div>
              <div className="tutorial-header-actions">
                <button
                  type="button"
                  className="primary kitchen-mode-entry-btn"
                  onClick={() => {
                    setKitchenModeActive(true);
                    setKitchenCurrentStep(0);
                    setKitchenTimer(null);
                    setKitchenTimerActive(false);
                  }}
                >
                  👨‍🍳 厨房实操模式
                </button>
                <button
                  className="grocery-platform-close"
                  type="button"
                  onClick={() => setTutorialRecipe(null)}
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="tutorial-dialog-body">
              <section className="tutorial-section">
                <h3>📦 食材核对</h3>
                <div className="tutorial-ingredients-grid">
                  {tutorialRecipe.ingredients.map((item) => (
                    <div
                      key={item.food_id}
                      className={`tutorial-ingredient-chip ${item.available ? 'available' : 'missing'}`}
                    >
                      <span className="dot" />
                      <strong>{item.food_name}</strong>
                      <small>
                        {item.quantity
                          ? `${item.quantity}${unitLabel(item.unit_code ?? '')}`
                          : '适量'}
                      </small>
                      <span className="status">{item.available ? '已有' : '缺少'}</span>
                    </div>
                  ))}
                </div>
                {tutorialRecipe.missing.length > 0 ? (
                  <button
                    type="button"
                    className="primary tutorial-add-missing-btn"
                    disabled={addingRecipeId === tutorialRecipe.id}
                    onClick={async () => {
                      setAddingRecipeId(tutorialRecipe.id);
                      try {
                        const result = await addMissingRecipeItems(household.id, tutorialRecipe.id);
                        const nextShopping = await fetchShoppingList(household.id);
                        setShopping(nextShopping);
                        setMessage(`已把 ${result.items.length} 项缺少食材放入待购清单。`);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '加入失败');
                      } finally {
                        setAddingRecipeId(null);
                      }
                    }}
                  >
                    {addingRecipeId === tutorialRecipe.id
                      ? '加入中…'
                      : `把 ${tutorialRecipe.missing.length} 项缺料一键加入待购清单`}
                  </button>
                ) : null}
              </section>

              <section className="tutorial-section">
                <div className="tutorial-section-title">
                  <h3>🍳 制作步骤教程</h3>
                  <small>
                    进度：{completedSteps.size} / {tutorialRecipe.instructions.length} 步 (
                    {Math.round(
                      (completedSteps.size / Math.max(1, tutorialRecipe.instructions.length)) * 100,
                    )}
                    %)
                  </small>
                </div>
                <div className="tutorial-progress-bar">
                  <div
                    className="tutorial-progress-fill"
                    style={{
                      width: `${(completedSteps.size / Math.max(1, tutorialRecipe.instructions.length)) * 100}%`,
                    }}
                  />
                </div>
                <ol className="tutorial-steps-list">
                  {tutorialRecipe.instructions.map((step, idx) => {
                    const isDone = completedSteps.has(idx);
                    return (
                      <li
                        key={idx}
                        className={`tutorial-step-item ${isDone ? 'done' : ''}`}
                        onClick={() => {
                          const next = new Set(completedSteps);
                          if (isDone) next.delete(idx);
                          else next.add(idx);
                          setCompletedSteps(next);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => {}} // handled by li onClick
                        />
                        <span className="step-num">{idx + 1}</span>
                        <span className="step-text">{step}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section className="tutorial-section tutorial-external-links">
                <h3>🎥 外部视频与社区教程搜索</h3>
                <p className="hint">如需观看主厨实操视频或查看社区讨论，可一键前往以下平台：</p>
                <div className="tutorial-external-btns">
                  <a
                    href={`https://search.bilibili.com/all?keyword=${encodeURIComponent(tutorialRecipe.name + ' 教程')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="external-link-btn bilibili"
                  >
                    📺 Bilibili 视频教程
                  </a>
                  <a
                    href={`https://www.xiachufang.com/search/?keyword=${encodeURIComponent(tutorialRecipe.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="external-link-btn xiachufang"
                  >
                    📖 下厨房 社区菜谱
                  </a>
                  <a
                    href={`https://so.meishij.net/index.php?q=${encodeURIComponent(tutorialRecipe.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="external-link-btn meishij"
                  >
                    🔍 美食杰 做法搜寻
                  </a>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {kitchenModeActive && tutorialRecipe ? (
        <div className="grocery-platform-backdrop kitchen-mode-backdrop">
          <section
            className="grocery-platform-dialog kitchen-mode-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="厨房实操模式"
          >
            <div className="kitchen-dialog-header">
              <div>
                <span>
                  厨房实操模式 · 步骤 {kitchenCurrentStep + 1} /{' '}
                  {tutorialRecipe.instructions.length}
                </span>
                <h2>{tutorialRecipe.name}</h2>
              </div>
              <button
                type="button"
                className="grocery-platform-close"
                onClick={() => {
                  setKitchenModeActive(false);
                  getTts().stop();
                }}
              >
                退出厨房模式
              </button>
            </div>

            <div className="kitchen-dialog-body">
              <div className="kitchen-step-card">
                <div className="kitchen-step-card-header">
                  <div className="kitchen-step-badge">步骤 {kitchenCurrentStep + 1}</div>
                  <button
                    type="button"
                    className="secondary timer-btn speak-step-btn"
                    onClick={() => {
                      const text = tutorialRecipe.instructions[kitchenCurrentStep];
                      if (text) {
                        getTts().stop();
                        void getTts().speak(`步骤 ${kitchenCurrentStep + 1}：${text}`);
                      }
                    }}
                  >
                    🔊 朗读本步
                  </button>
                </div>
                <p className="kitchen-step-instruction">
                  {tutorialRecipe.instructions[kitchenCurrentStep]}
                </p>

                {/* 智能检测步骤中的时间词并提供倒计时器 */}
                {(() => {
                  const text = tutorialRecipe.instructions[kitchenCurrentStep] || '';
                  const matchMin = text.match(/(\d+)\s*分钟/);
                  const matchSec = text.match(/(\d+)\s*秒/);
                  const parsedSec = matchMin
                    ? Number(matchMin[1]) * 60
                    : matchSec
                      ? Number(matchSec[1])
                      : null;

                  return parsedSec ? (
                    <div className="kitchen-step-timer-box">
                      <div className="timer-display">
                        ⏱ 计时：
                        {kitchenTimer !== null
                          ? `${Math.floor(kitchenTimer / 60)}:${String(kitchenTimer % 60).padStart(2, '0')}`
                          : `${Math.floor(parsedSec / 60)}分${parsedSec % 60 ? (parsedSec % 60) + '秒' : ''}`}
                      </div>
                      <div className="timer-controls">
                        {!kitchenTimerActive ? (
                          <button
                            type="button"
                            className="primary timer-btn"
                            onClick={() => {
                              if (kitchenTimer === null || kitchenTimer <= 0)
                                setKitchenTimer(parsedSec);
                              setKitchenTimerActive(true);
                            }}
                          >
                            {kitchenTimer === 0 ? '重新计时' : '开始计时'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary timer-btn"
                            onClick={() => setKitchenTimerActive(false)}
                          >
                            暂停
                          </button>
                        )}
                        {kitchenTimer !== null ? (
                          <button
                            type="button"
                            className="secondary timer-btn"
                            onClick={() => {
                              setKitchenTimerActive(false);
                              setKitchenTimer(null);
                            }}
                          >
                            重置
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="kitchen-nav-row">
                <button
                  type="button"
                  className="secondary kitchen-nav-btn"
                  disabled={kitchenCurrentStep === 0}
                  onClick={() => {
                    const prevStep = Math.max(0, kitchenCurrentStep - 1);
                    setKitchenCurrentStep(prevStep);
                    setKitchenTimer(null);
                    setKitchenTimerActive(false);
                    const text = tutorialRecipe.instructions[prevStep];
                    if (text) {
                      getTts().stop();
                      void getTts().speak(`步骤 ${prevStep + 1}：${text}`);
                    }
                  }}
                >
                  ← 上一步
                </button>
                {kitchenCurrentStep < tutorialRecipe.instructions.length - 1 ? (
                  <button
                    type="button"
                    className="primary kitchen-nav-btn"
                    onClick={() => {
                      const nextStep = kitchenCurrentStep + 1;
                      setCompletedSteps((prev) => new Set([...prev, kitchenCurrentStep]));
                      setKitchenCurrentStep(nextStep);
                      setKitchenTimer(null);
                      setKitchenTimerActive(false);
                    }}
                  >
                    完成本步，下一步 →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary kitchen-nav-btn finish-btn"
                    onClick={() => {
                      setCompletedSteps(
                        new Set(
                          Array.from({ length: tutorialRecipe.instructions.length }, (_, i) => i),
                        ),
                      );
                      setKitchenModeActive(false);
                      setMessage(`🎉 恭喜完成【${tutorialRecipe.name}】的制作！`);
                    }}
                  >
                    🎉 完成全套烹饪
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
