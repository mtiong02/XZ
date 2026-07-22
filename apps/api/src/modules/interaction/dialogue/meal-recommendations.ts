export type MealOccasion = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'AFTERNOON_TEA' | 'LATE_NIGHT' | 'GENERAL';
export type DiningMode = 'SOLO' | 'FAMILY' | 'GATHERING' | 'UNSPECIFIED';
export type MealDateReference = 'TODAY' | 'TOMORROW' | 'DAY_AFTER_TOMORROW' | 'UNSPECIFIED';

export interface MealContext {
  occasion: MealOccasion;
  dateReference: MealDateReference;
  diningMode: DiningMode;
  dinerCount: number | null;
  wantsQuick: boolean;
  weightConscious: boolean;
}

export interface MealRecipeCandidate {
  name: string;
  servings: number;
  can_make: boolean;
  coverage: number;
  missing: Array<{ food_name: string; quantity: string | null; unit_code: string | null }>;
}

const DINER_CN_NUMBERS: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 从自然语言中提取用餐场景；它只解释用户意图，不产生任何库存副作用。 */
export function parseMealContext(text: string): MealContext {
  const compact = text.replace(/[\s，。！？、,.!?：:；;]/g, '');
  const occasion: MealOccasion = /早餐|早饭|早上(?:吃|用餐)?/.test(compact)
    ? 'BREAKFAST'
    : /午餐|中饭|中午吃/.test(compact)
      ? 'LUNCH'
      : /晚餐|晚饭|今晚|晚上|家庭晚餐|晚上一家/.test(compact)
        ? 'DINNER'
        : /下午茶|加餐|小点心|点心|零食/.test(compact)
          ? 'AFTERNOON_TEA'
            : /夜宵|宵夜/.test(compact)
              ? 'LATE_NIGHT'
              : 'GENERAL';
  const dateReference: MealDateReference = /后天/.test(compact)
    ? 'DAY_AFTER_TOMORROW'
    : /明天|明早|明早上/.test(compact)
      ? 'TOMORROW'
      : /今天|今早|今早上|今晚/.test(compact)
        ? 'TODAY'
        : 'UNSPECIFIED';
  const numeric = /(\d{1,2})\s*(?:人份?|位|口)/.exec(compact)?.[1];
  const chinese = /([一二两三四五六七八九十])(?:个)?(?:人|位|口)/.exec(compact)?.[1];
  const dinerCount = numeric ? Number(numeric) : chinese ? (DINER_CN_NUMBERS[chinese] ?? null) : /一个人|自己吃|独自/.test(compact) ? 1 : null;
  const diningMode: DiningMode = dinerCount === 1
    ? 'SOLO'
    : /聚会|朋友来|客人|宴请|一起吃|一起用餐|跟.*吃/.test(compact)
      ? 'GATHERING'
      : /全家|家庭|一家人|家里人/.test(compact)
        ? 'FAMILY'
        : 'UNSPECIFIED';
  return {
    occasion,
    dateReference,
    diningMode,
    dinerCount,
    wantsQuick: /简单|快手|省事|不想做|方便|快速/.test(compact),
    weightConscious: /减脂|减肥|控卡|低脂|轻食/.test(compact),
  };
}

/**
 * 轻量、确定性的餐食建议：只根据已经读取到的库存生成建议，不写库存也不假设用户已食用。
 * 下午茶优先选择水果、酸奶、蛋类等即食或低准备成本食材，避免把生肉推荐成加餐。
 */
export function buildAfternoonTeaRecommendation(items: ReadonlyArray<{ name: string }>): string {
  const available = new Set(items.map((item) => item.name));
  if (available.has('酸奶') && available.has('苹果')) {
    const extra = available.has('西瓜') ? '，喜欢更清爽可以加少量西瓜' : '';
    return `下午茶推荐做苹果酸奶杯：用1盒酸奶配1个苹果${extra}。准备很简单，也有一定饱腹感；这是建议，不会自动扣减库存。`;
  }
  if (available.has('酸奶') && available.has('西瓜'))
    return '下午茶推荐做一份西瓜酸奶杯：取1盒酸奶，配一小份西瓜即可。清爽、准备快；这是建议，不会自动扣减库存。';
  if (available.has('苹果') && available.has('鸡蛋'))
    return '下午茶推荐苹果配水煮蛋：1个苹果加1个水煮蛋，简单又比单吃甜食更有饱腹感。这是建议，不会自动扣减库存。';
  if (available.has('苹果') || available.has('西瓜')) {
    const fruit = available.has('苹果') ? '苹果' : '西瓜';
    return `下午茶可以先切一小份${fruit}；如果想更有饱腹感，可以再补充一份蛋白质食材。这是建议，不会自动扣减库存。`;
  }
  return '当前库存里暂时没有特别适合快速下午茶的水果或酸奶。你可以补充一份水果、酸奶或全麦主食，我再按现有库存搭配。';
}

/** 根据场景、人数和库存覆盖度选择一份可解释的餐食候选。 */
export function buildMealContextRecommendation(
  context: MealContext,
  items: ReadonlyArray<{ name: string }>,
  recipes: ReadonlyArray<MealRecipeCandidate>,
  householdMemberCount: number,
): string {
  if (context.occasion === 'AFTERNOON_TEA') return buildAfternoonTeaRecommendation(items);

  const available = new Set(items.map((item) => item.name));
  if (context.occasion === 'BREAKFAST' && available.has('酸奶') && available.has('苹果')) {
    const pairing = available.has('鸡蛋') ? '1个水煮蛋' : '一小份水果';
    return `早餐推荐苹果酸奶配${pairing}。${context.wantsQuick ? '这套准备很快。' : ''}这是建议，不会自动扣减库存。`;
  }

  const ready = recipes.find((recipe) => recipe.can_make);
  const best = ready ?? recipes[0];
  const occasionLabel: Record<MealOccasion, string> = {
    BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', AFTERNOON_TEA: '下午茶', LATE_NIGHT: '夜宵', GENERAL: '这一餐',
  };
  const requestedPeople = context.dinerCount ?? (context.diningMode === 'FAMILY' ? householdMemberCount : null);
  const peopleLabel = requestedPeople ? `${requestedPeople}人` : context.diningMode === 'GATHERING' ? '多人聚会' : context.diningMode === 'SOLO' ? '1人' : '';
  const goalNote = context.weightConscious ? '可优先采用蒸、煮、炖等少油做法。' : '';
  const quickNote = context.wantsQuick ? '我优先选了准备步骤较少的候选。' : '';

  if (!best) {
    return `${occasionLabel[context.occasion]}目前没有足够的库存菜谱候选。可以补充蔬菜和一种主食后，我再按${peopleLabel || '用餐人数'}给你搭配。`;
  }
  if (context.diningMode === 'GATHERING' || (requestedPeople ?? 0) >= 4) {
    const menu = recipes
      .filter((recipe) => recipe.can_make)
      .slice(0, 3);
    if (menu.length >= 2) {
      const dishList = menu.map((recipe) => recipe.name).join('、');
      const servingNote = requestedPeople
        ? `按${requestedPeople}人准备时，请按各菜谱基准人份同比例放大，并在下锅前复核库存。`
        : '请按实际到场人数同比例放大，并在下锅前复核库存。';
      return `${occasionLabel[context.occasion]}可以安排一桌${menu.length}道菜：${dishList}。${servingNote}${goalNote}这是根据当前库存的菜单建议，不会自动扣减食材。`;
    }
  }
  if (!best.can_make) {
    const missing = best.missing
      .map((item) => `${item.food_name}${item.quantity ?? ''}${item.unit_code ?? ''}`)
      .join('、');
    return `${occasionLabel[context.occasion]}可以考虑${best.name}，但当前还缺${missing || '部分食材'}。${quickNote}${goalNote}如果你明确说“加入购物清单”，我再帮你创建待购项。`;
  }
  const servingNote = requestedPeople && requestedPeople !== best.servings
    ? `菜谱基准是${best.servings}人份；${peopleLabel}用餐建议按约${(requestedPeople / best.servings).toFixed(1)}倍备料，并在下锅前再核对库存。`
    : `${peopleLabel || `${best.servings}人` }份可做。`;
  return `${occasionLabel[context.occasion]}推荐${best.name}。${servingNote}${quickNote}${goalNote}这是建议，不会自动扣减库存。`;
}
