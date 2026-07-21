/**
 * 规则版 Intent Parser（docs/02 §10.2）。
 * 确定性、可测试、可回归；LLM Provider 未来可作为增强插入同一接口。
 * 输出结构化候选命令；不直接调用任何 Repository（docs/02 §10.2 规则）。
 */

export interface FoodCatalogEntry {
  id: string;
  canonicalName: string;
  defaultUnitCode: string;
  aliases: string[];
}

export type ParsedIntent =
  'ADD_INVENTORY' | 'CONSUME_INVENTORY' | 'DISCARD_INVENTORY' | 'QUERY_INVENTORY' | 'UNKNOWN';

export interface ParsedItem {
  food_id: string;
  food_name: string;
  quantity: string;
  unit: string;
  quantity_explicit: boolean;
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
      /买了|新买|购入|添加|加了|放了|放进|存了|入库|带回|加(?!热|工)|bought|add(ed)?|got/i,
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
  斤: 'jin-special',
  毫升: 'ml',
  ml: 'ml',
  升: 'l',
  l: 'l',
};

const QUANTITY_PATTERN =
  /(\d+(?:\.\d+)?)\s*(千克|公斤|毫升|克|盒|瓶|包|袋|把|个|只|颗|枚|根|斤|升|kg|ml|g|l)/gi;

/** 抽取文本中所有「数量+单位」，按出现顺序返回（含 斤->500g）。 */
export function extractQuantities(normalized: string): { quantity: string; unit: string }[] {
  const results: { quantity: string; unit: string }[] = [];
  for (const match of normalized.matchAll(new RegExp(QUANTITY_PATTERN.source, 'gi'))) {
    const rawUnit = (match[2] ?? '').toLowerCase();
    let unit = UNIT_WORDS[rawUnit] ?? rawUnit;
    let quantity = match[1] ?? '1';
    if (unit === 'jin-special') {
      unit = 'g';
      quantity = String(Number(quantity) * 500);
    }
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
  if (unit === 'jin-special') {
    // 1 斤 = 500g
    return { unit: 'g', quantity: String(Number(quantity) * 500) };
  }
  return { unit, quantity };
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
  return {
    food_id: match.entry.id,
    food_name: match.entry.canonicalName,
    quantity,
    unit,
    quantity_explicit: explicit,
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
