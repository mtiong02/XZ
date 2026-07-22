/**
 * 规则版 Intent Parser（docs/02 §10.2）。
 * 确定性、可测试、可回归；LLM Provider 未来可作为增强插入同一接口。
 * 输出结构化候选命令；不直接调用任何 Repository（docs/02 §10.2 规则）。
 */

export interface FoodCatalogEntry {
  id: string;
  canonicalName: string;
  category?: string;
  defaultUnitCode: string;
  preferredUnitCodes?: string[];
  aliases: string[];
}

export type ParsedIntent =
  | 'ADD_INVENTORY'
  | 'CONSUME_INVENTORY'
  | 'DISCARD_INVENTORY'
  | 'MOVE_INVENTORY'
  | 'QUERY_INVENTORY'
  | 'QUERY_REMINDERS'
  | 'CREATE_REMINDER'
  | 'EXTERNAL_PURCHASE'
  | 'ADD_SHOPPING_ITEM'
  | 'REMOVE_SHOPPING_ITEM'
  | 'MARK_SHOPPING_PURCHASED'
  | 'QUERY_SHOPPING_LIST'
  | 'UNKNOWN';

export interface ParsedItem {
  food_id: string;
  food_name: string;
  quantity: string;
  unit: string;
  quantity_explicit: boolean;
  unit_reasonable: boolean;
  suggested_units: string[];
}

export interface ParseResult {
  intent: ParsedIntent;
  items: ParsedItem[];
  confidence: {
    intent: number;
    food_entity: number;
    quantity: number;
    overall: number;
  };
}

const INTENT_RULES: { intent: ParsedIntent; patterns: RegExp[]; weight: number }[] = [
  {
    intent: 'DISCARD_INVENTORY',
    patterns: [/扔了|扔掉|丢了|丢掉|倒掉|倒了|坏了|变质|过期了.*扔|threw away|discard/i],
    weight: 0.95,
  },
  {
    intent: 'CONSUME_INVENTORY',
    // 含裸"用/吃/喝"（"用两个鸡蛋"），排除"用来/用于"等非消耗动词
    patterns: [/用(?!来|于)|吃|喝(?!彩)|消耗|做饭|煮了|炒了|used|ate|drank/i],
    weight: 0.95,
  },
  {
    intent: 'ADD_INVENTORY',
    // 含裸"加"（"加两盒牛奶"），但排除"加热"等非入库动词
    patterns: [
      /买了|新买|购入|添加|添(?:加)?|加了|放了|放进|存了|入库|带回|加(?!热|工)|bought|add(ed)?|got/i,
    ],
    weight: 0.95,
  },
  {
    intent: 'QUERY_INVENTORY',
    patterns: [/还有多少|有没有|还剩|查一下|看看|库存|how (much|many)|do we have/i],
    weight: 0.9,
  },
];

/** 单位词 -> 单位码（与 units 表一致） */
const UNIT_WORDS: Record<string, string> = {
  个: 'piece',
  只: 'piece',
  颗: 'piece',
  枚: 'piece',
  根: 'piece',
  片: 'piece',
  块: 'piece',
  段: 'piece',
  盒: 'box',
  瓶: 'bottle',
  包: 'pack',
  袋: 'bag',
  把: 'bunch',
  克: 'g',
  g: 'g',
  千克: 'kg',
  公斤: 'kg',
  kg: 'kg',
  斤: 'jin',
  毫升: 'ml',
  ml: 'ml',
  升: 'l',
  l: 'l',
};

const QUANTITY_PATTERN =
  /(\d+(?:\.\d+)?)\s*(千克|公斤|毫升|克|盒|瓶|包|袋|把|个|只|颗|枚|根|片|块|段|斤|升|kg|ml|g|l)/gi;

const INFORMATION_REQUEST = /请用\d+句|怎么|怎样|如何|做什么|介绍|告诉我|能否|能不能|是否|可以.+吗/;
const INVENTORY_CATEGORY_QUERY =
  /(?:有|剩)(?:哪些|什么)(?:肉类?|荤菜|蔬菜|青菜|菜类|水果|海鲜|水产|鱼虾|龙虾|贝类|蛋奶|奶制品|乳制品|蛋类|豆制品|主食|粮食|谷物|菌菇|蘑菇|调味料|调料|佐料)|(?:肉类?|荤菜|蔬菜|青菜|菜类|水果|海鲜|水产|鱼虾|龙虾|贝类|蛋奶|奶制品|乳制品|蛋类|豆制品|主食|粮食|谷物|菌菇|蘑菇|调味料|调料|佐料)(?:有|剩)(?:哪些|什么|多少)/;
const INVENTORY_QUERY_REQUEST =
  /(?:冰箱|冷藏|冷冻|常温|库存|家里).*(?:有|剩|哪些|什么)|(?:我|我们)?(?:有|剩)(?:哪些|什么)食材|(?:有哪些|有什么|列出|盘点|查找|查询).*(?:食材|东西|菜)|(?:哪些|什么).*(?:快过期|临期|已经过期)|(?:快过期|临期|过期).*(?:哪些|什么)|(?:今天|今晚|中午).*(?:吃什么|做什么菜|做点什么)|(?:这些|现有|冰箱里|库存里).*(?:能做|可以做|吃什么|怎么吃|美食|菜谱|减脂餐)|(?:减脂|减肥).*(?:餐|吃什么|怎么吃|推荐)/;
const MEAL_OR_SHOPPING_ADVICE_REQUEST =
  /(?:想吃|做).*(?:还要买|还缺|缺什么|买什么|怎么做)|(?:还要买|还缺|缺什么|买什么).*(?:菜|肉|汤|饭|牛腩|土豆)/;
const SNACK_RECOMMENDATION_REQUEST =
  /(?:下午茶|加餐|小点心|点心|零食).*(?:推荐|吃什么|有什么|做什么|怎么搭配|简单)|(?:推荐|吃什么|有什么|做什么|怎么搭配|简单).*(?:下午茶|加餐|小点心|点心|零食)/;
const MEAL_RECOMMENDATION_REQUEST =
  /(?:早餐|早饭|午餐|中饭|晚餐|晚饭|今晚|晚上|夜宵|宵夜|家庭餐|家庭晚餐|全家|一个人|多人|几个人|[一二两三四五六七八九十\d]+(?:个)?人|聚会|一起吃).*(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|菜单|餐食|菜品|菜|简单|快手)|(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|菜单|餐食|菜品|菜|简单|快手).*(?:早餐|早饭|午餐|中饭|晚餐|晚饭|今晚|晚上|夜宵|宵夜|家庭餐|家庭晚餐|全家|一个人|多人|几个人|聚会|一起吃)|(?:明天|后天|今天|今晚|早上|中午|晚上)?(?:早餐|早饭|午餐|中饭|晚餐|晚饭|下午茶|加餐|夜宵|宵夜|家庭餐|家庭晚餐|聚会).{0,24}(?:吃|用餐|两个人|三个人|四个人|五个人|六个人|[一二两三四五六七八九十\d]+(?:个)?(?:人|位|口)|安排|准备)|(?:想吃|想要吃|吃什么|做什么).{0,30}(?:你来推荐|帮我推荐|你推荐|推荐一下|你安排|随便安排|帮我选)/;
const RECIPE_FOLLOW_UP_REQUEST =
  /食谱|菜谱|具体(?:的)?菜|菜单|餐食|菜品|执行方案|给我.*(?:一道|几个|几道).*菜|继续.*(?:刚才|上一个|前面).*(?:食谱|菜|推荐)|(?:少油|少盐|清淡|低脂).*(?:做法|菜|餐|食谱|就好)|(?:搭配|菜单|方案|推荐).*(?:不合理|不够|调整|修改)|(?:不合理|不够).*(?:调味料|食材|吃|人份|菜|餐|搭配)|(?:晚餐|午餐|早餐|下午茶|聚会|朋友来|家庭晚餐|晚上|今晚).*(?:食谱|菜谱|几道菜|搭配|菜单)/;
const MOVE_INVENTORY_REQUEST =
  /(?:移到|移去|挪到|转到|换到|放到).*(?:冷冻|冷库|冷柜|冰柜|冷藏|保鲜|常温|室温|橱柜|储物柜)|(?:冷冻|冷库|冷柜|冰柜|冷藏|保鲜|常温|室温|橱柜|储物柜).*(?:移|挪|转|换)/;
const REMINDER_QUERY_REQUEST =
  /(?:今天|明天|后天|今晚).*(?:安排|计划|提醒).*(?:什么|哪些|啥|有没有|查看|看一下|查一下)|(?:查看|看一下|查一下|告诉我).*(?:今天|明天|后天|今晚).*(?:安排|计划|提醒)|(?:今天|明天|后天|今晚).*(?:有什么|有哪些).*(?:安排|计划|提醒)|(?:今天|明天|后天|今晚).*有(?:安排|计划|提醒)(?:吗|呢)/;
const EXPLICIT_COMPLETED_ACTION =
  /用了|用掉|吃了|吃掉|喝了|喝掉|买了|新买|购入|添加|加了|放进|入库|扔了|扔掉|丢了|丢掉|倒掉/;

/** 用户陈述“冰箱里有三颗西瓜”时，视为待确认的入库候选，而不是库存查询。 */
const INVENTORY_DECLARATION =
  /^(?:嗯|呃|那个|好的)?(?:我)?(?:家里|冰箱)(?:里|里面)?有(?:\d|[一二两俩三四五六七八九十百千半])/;

/** 将自然语言存放位置转为稳定区域代码；实际 zone id 由 Interaction 模块按家庭查询。 */
export function requestedStorageZoneCode(normalized: string): 'FRIDGE' | 'FREEZER' | 'PANTRY' | null {
  if (/冷冻|冷库|冷柜|冰柜/.test(normalized)) return 'FREEZER';
  if (/冷藏|保鲜/.test(normalized)) return 'FRIDGE';
  if (/常温|室温|橱柜|储物柜/.test(normalized)) return 'PANTRY';
  return null;
}

/** 抽取文本中所有「数量+单位」，按出现顺序返回；斤保留为可播报单位，执行时再换算。 */
export function extractQuantities(normalized: string): { quantity: string; unit: string }[] {
  const results: { quantity: string; unit: string }[] = [];
  for (const match of normalized.matchAll(new RegExp(QUANTITY_PATTERN.source, 'gi'))) {
    const rawUnit = (match[2] ?? '').toLowerCase();
    const unit = UNIT_WORDS[rawUnit] ?? rawUnit;
    const quantity = match[1] ?? '1';
    results.push({ quantity, unit });
  }
  return results;
}

/** 抽取第一个「数量+单位」。无则 null。 */
export function extractFirstQuantity(
  normalized: string,
): { quantity: string; unit: string } | null {
  return extractQuantities(normalized)[0] ?? null;
}

/**
 * 抽取修正回复的目标数量：取最后一个（"不是两盒是三盒" -> 三盒）。
 * 修正话术惯例是先旧后新。无则 null。
 */
export function extractCorrectionQuantity(
  normalized: string,
): { quantity: string; unit: string } | null {
  const all = extractQuantities(normalized);
  return all[all.length - 1] ?? null;
}

export function detectIntent(normalized: string): { intent: ParsedIntent; confidence: number } {
  if (REMINDER_QUERY_REQUEST.test(normalized)) {
    return { intent: 'QUERY_REMINDERS', confidence: 0.98 };
  }
  if (
    /(?:提醒(?:一|1)?下?我|到时候提醒|记得提醒|别忘了提醒|定(?:一个|1个|个)?提醒|设置(?:一个|1个)?提醒|安排(?:一个|1个)?提醒)/.test(
      normalized,
    )
  ) {
    return { intent: 'CREATE_REMINDER', confidence: 0.98 };
  }
  if (
    /(?:从|在)?(?:购物清单|待购清单).*(?:移除|删除|删掉|取消|不要买|不要了)|(?:移除|删除|删掉|取消).*(?:购物清单|待购清单)/.test(
      normalized,
    )
  ) {
    return { intent: 'REMOVE_SHOPPING_ITEM', confidence: 0.98 };
  }
  if (
    /(?:购物清单|待购清单).*(?:买好了|买了|已经买|已购买|划掉)|(?:买好了|买了|已经买|已购买).*(?:购物清单|待购清单)|(?:待购|清单|已买).*(?:买好了|买了|已经买|划掉)/.test(
      normalized,
    )
  ) {
    return { intent: 'MARK_SHOPPING_PURCHASED', confidence: 0.98 };
  }
  if (/(?:加入|加到|添加到).{0,20}(?:购物清单|待购清单)|(?:购物清单|待购清单).{0,10}(?:加|添加)/.test(normalized)) {
    return { intent: 'ADD_SHOPPING_ITEM', confidence: 0.98 };
  }
  if (
    /(?:看看|查看|查询|读一下)?(?:购物清单|待购清单).*(?:有什么|有哪些|是什么|内容)|(?:购物清单|待购清单)$/.test(normalized)
  ) {
    return { intent: 'QUERY_SHOPPING_LIST', confidence: 0.98 };
  }
  if (/(?:帮我|替我|给我).*(?:下单|购买)|(?:下单|网购|外卖).*(?:买|购买)?/.test(normalized)) {
    return { intent: 'EXTERNAL_PURCHASE', confidence: 0.98 };
  }
  if (INVENTORY_DECLARATION.test(normalized)) {
    return { intent: 'ADD_INVENTORY', confidence: 0.9 };
  }
  if (MOVE_INVENTORY_REQUEST.test(normalized) && requestedStorageZoneCode(normalized)) {
    return { intent: 'MOVE_INVENTORY', confidence: 0.96 };
  }
  if (SNACK_RECOMMENDATION_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.92 };
  }
  if (MEAL_RECOMMENDATION_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.92 };
  }
  if (RECIPE_FOLLOW_UP_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.9 };
  }
  if (MEAL_OR_SHOPPING_ADVICE_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.88 };
  }
  if (INVENTORY_QUERY_REQUEST.test(normalized) || INVENTORY_CATEGORY_QUERY.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.95 };
  }
  // “请用三句话介绍…”、“怎么用鸡蛋做菜”属于知识/闲聊请求，不是库存扣减。
  // 只有同时出现明确的已完成动作（如“用了两个鸡蛋”）才允许进入写操作解析。
  if (INFORMATION_REQUEST.test(normalized) && !EXPLICIT_COMPLETED_ACTION.test(normalized)) {
    return { intent: 'UNKNOWN', confidence: 0 };
  }
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return { intent: rule.intent, confidence: rule.weight };
    }
  }
  return { intent: 'UNKNOWN', confidence: 0 };
}

interface FoodMatch {
  entry: FoodCatalogEntry;
  index: number;
  matchedText: string;
}

/** 在文本中查找食材（canonical + alias，最长匹配优先）。 */
export function matchFoods(normalized: string, catalog: FoodCatalogEntry[]): FoodMatch[] {
  const matches: FoodMatch[] = [];
  for (const entry of catalog) {
    const names = [entry.canonicalName, ...entry.aliases].sort((a, b) => b.length - a.length);
    for (const name of names) {
      const index = normalized.toLowerCase().indexOf(name.toLowerCase());
      if (index !== -1) {
        matches.push({ entry, index, matchedText: name });
        break;
      }
    }
  }
  // 去掉与更长匹配重叠的短匹配（例如“西红柿”与“柿子”）
  matches.sort((a, b) => b.matchedText.length - a.matchedText.length);
  const kept: FoodMatch[] = [];
  for (const match of matches) {
    const overlaps = kept.some(
      (existing) =>
        match.index < existing.index + existing.matchedText.length &&
        existing.index < match.index + match.matchedText.length,
    );
    if (!overlaps) kept.push(match);
  }
  return kept.sort((a, b) => a.index - b.index);
}

interface QuantityMatch {
  start: number;
  end: number;
  quantity: string;
  unit: string | null;
  used: boolean;
}

function normalizeUnit(rawUnit: string, quantity: string): { unit: string; quantity: string } {
  const unit = UNIT_WORDS[rawUnit.toLowerCase()] ?? rawUnit;
  return { unit, quantity };
}

const CATEGORY_UNIT_DEFAULTS: Record<string, string[]> = {
  VEGETABLE: ['jin', 'g', 'kg', 'piece', 'bunch'],
  FRUIT: ['piece', 'jin', 'kg'],
  MEAT: ['jin', 'g', 'kg'],
  SEAFOOD: ['jin', 'g', 'kg'],
  GRAIN: ['jin', 'kg', 'g', 'bag', 'pack'],
};

export function suggestedUnitsForFood(entry: FoodCatalogEntry): string[] {
  const configured = entry.preferredUnitCodes?.filter(Boolean) ?? [];
  if (configured.length > 0) return configured;
  return CATEGORY_UNIT_DEFAULTS[entry.category ?? ''] ?? [entry.defaultUnitCode];
}

export function isReasonableUnitForFood(entry: FoodCatalogEntry, unit: string): boolean {
  return suggestedUnitsForFood(entry).includes(unit);
}

function collectQuantityMatches(normalized: string): QuantityMatch[] {
  const matches: QuantityMatch[] = [];
  for (const qMatch of normalized.matchAll(QUANTITY_PATTERN)) {
    const { unit, quantity } = normalizeUnit(qMatch[2] ?? '', qMatch[1] ?? '1');
    matches.push({
      start: qMatch.index,
      end: qMatch.index + qMatch[0].length,
      quantity,
      unit,
      used: false,
    });
  }
  return matches;
}

/**
 * 数量分配（就近邻接原则）：
 * 1. 食材名前紧邻的「数量+单位」（如 "2盒牛奶"）；
 * 2. 食材名后短距离内的「数量+单位」，且它不属于下一个食材（如 "菠菜…扔了300克"）；
 * 3. 食材名前紧邻的裸数字（如 "6 eggs"），使用食材默认单位；
 * 4. 都没有 -> 默认 1，标记非显式（低置信度，需要用户确认）。
 */
function assignQuantities(
  normalized: string,
  foodMatches: FoodMatch[],
  quantityMatches: QuantityMatch[],
): ParsedItem[] {
  const foodStarts = foodMatches.map((m) => m.index);

  return foodMatches.map((match) => {
    const foodStart = match.index;
    const foodEnd = match.index + match.matchedText.length;
    const defaultUnit = match.entry.defaultUnitCode;

    // 1. 前置紧邻（间隔 <= 3，容忍 "的"、空格）
    const before = quantityMatches
      .filter((q) => !q.used && q.end <= foodStart && foodStart - q.end <= 3)
      .sort((a, b) => b.end - a.end)[0];
    if (before) {
      before.used = true;
      return buildItem(match, before.quantity, before.unit ?? defaultUnit, true);
    }

    // 2. 后置短距离（间隔 <= 8），且该数量不是下一个食材的前置数量
    const after = quantityMatches
      .filter((q) => {
        if (q.used || q.start < foodEnd || q.start - foodEnd > 8) return false;
        const belongsToNextFood = foodStarts.some((start) => start > q.end && start - q.end <= 3);
        return !belongsToNextFood;
      })
      .sort((a, b) => a.start - b.start)[0];
    if (after) {
      after.used = true;
      return buildItem(match, after.quantity, after.unit ?? defaultUnit, true);
    }

    // 3. 前置裸数字（如英文 "6 eggs"）
    const prefix = normalized.slice(Math.max(0, foodStart - 6), foodStart);
    const bare = /(\d+(?:\.\d+)?)\s*$/.exec(prefix);
    if (bare?.[1]) {
      const bareEnd = foodStart - (prefix.length - (bare.index + bare[0].length));
      const insideUnitMatch = quantityMatches.some((q) => bareEnd > q.start && bareEnd <= q.end);
      if (!insideUnitMatch) {
        return buildItem(match, bare[1], defaultUnit, true);
      }
    }

    return buildItem(match, '1', defaultUnit, false);
  });
}

function buildItem(
  match: FoodMatch,
  quantity: string,
  unit: string,
  explicit: boolean,
): ParsedItem {
  const suggestedUnits = suggestedUnitsForFood(match.entry);
  return {
    food_id: match.entry.id,
    food_name: match.entry.canonicalName,
    quantity,
    unit,
    quantity_explicit: explicit,
    unit_reasonable: suggestedUnits.includes(unit),
    suggested_units: suggestedUnits,
  };
}

export function parseTranscript(normalized: string, catalog: FoodCatalogEntry[]): ParseResult {
  const { intent, confidence: intentConfidence } = detectIntent(normalized);
  const foodMatches = matchFoods(normalized, catalog);
  const items = assignQuantities(normalized, foodMatches, collectQuantityMatches(normalized));

  const foodConfidence = foodMatches.length > 0 ? 0.95 : 0;
  const quantityConfidence =
    items.length === 0 ? 0 : items.every((item) => item.quantity_explicit) ? 0.9 : 0.5;
  const overall =
    intent === 'UNKNOWN' || items.length === 0
      ? Math.min(intentConfidence, foodConfidence) * 0.5
      : Math.min(intentConfidence, foodConfidence, Math.max(quantityConfidence, 0.5));

  return {
    intent,
    items,
    confidence: {
      intent: intentConfidence,
      food_entity: foodConfidence,
      quantity: quantityConfidence,
      overall: Number(overall.toFixed(2)),
    },
  };
}
