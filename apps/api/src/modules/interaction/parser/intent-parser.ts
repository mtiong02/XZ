/**
 * 规则版 Intent Parser（docs/02 §10.2）。
 * 确定性、可测试、可回归；LLM Provider 未来可作为增强插入同一接口。
 * 输出结构化候选命令；不直接调用任何 Repository（docs/02 §10.2 规则）。
 *
 * v2: 扩充量词表（碗/勺/杯等容器量词）、增加量词距离容忍度（3→5）、
 *     grammar fallback 拼音模糊匹配。
 */

import { phoneticFoodMatch } from '../dialogue/phonetic-matcher';

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
  | 'KITCHEN_START_TUTORIAL'
  | 'KITCHEN_NEXT_STEP'
  | 'KITCHEN_PREV_STEP'
  | 'KITCHEN_REPEAT_STEP'
  | 'KITCHEN_TIMER_QUERY'
  | 'KITCHEN_INGREDIENT_QUERY'
  | 'SYSTEM_FEEDBACK'
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
    intent: 'KITCHEN_START_TUTORIAL',
    patterns: [
      /(?:教我做|怎么做|教教我做|开始做|带我做|制作教程|烹饪教程|做菜步骤|第[一1]步怎么做|怎么炒|怎么煮|怎么蒸|做法|具体怎么做)/i,
    ],
    weight: 0.99,
  },
  {
    intent: 'KITCHEN_TIMER_QUERY',
    patterns: [/倒计时|还有多久|还有多长时间|好了没有|还剩多少时间|还要炖多久|还要煮多长时间|还要炒多久/i],
    weight: 0.985,
  },
  {
    intent: 'KITCHEN_NEXT_STEP',
    patterns: [
      /(?:好[了啦的]?|完成[了啦的]?|行[了啦的]?|好的)?\s*(?:下[一1]步|下[一1]个|继续(?:讲|读|说)?|然后呢|往前|下[一1]项|好了(?!没有|吗)|做好了|完成|完成啦)/i,
      /(?:说|读|讲)?下[一1]步/i,
    ],
    weight: 0.98,
  },
  {
    intent: 'KITCHEN_PREV_STEP',
    patterns: [/^(?:上[一1]步|上[一1]个|退回|回到上[一1]步|刚才说的?|后退|上[一1]项)$/i, /(?:说|读|讲)?上[一1]步/i],
    weight: 0.98,
  },
  {
    intent: 'KITCHEN_REPEAT_STEP',
    patterns: [/^(?:重读|再说[一1]遍|没听清|重复(?:[一1]遍)?|再读[一1]遍)$/i, /(?:重复|重读)当前步骤/i],
    weight: 0.98,
  },
  {
    intent: 'KITCHEN_INGREDIENT_QUERY',
    patterns: [/需要什么食材|用什么配料|配方|准备什么|配料有哪些|所需食材|要哪些配料/i],
    weight: 0.95,
  },
  {
    intent: 'DISCARD_INVENTORY',
    patterns: [/扔了|扔掉|丢了|丢掉|倒掉|倒了|坏了|变质|过期了.*扔|threw away|discard/i],
    weight: 0.95,
  },
  {
    intent: 'CONSUME_INVENTORY',
    // 含裸"用/吃/喝"（"用两个鸡蛋"），排除"想吃/用来/用于"等非消耗动词
    patterns: [
      /用(?!来|于)|(?<!想|要|能|可以|怎么|什么)吃(?!什么|点什么|啥|饭|菜|药)|喝(?!彩)|消耗|做饭用了|煮了|炒了|吃了|吃掉|吃完|用掉|喝了|喝掉|used|ate|drank/i,
    ],
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
    patterns: [
      /(?:还有|还剩|有没有)(?:多少|什么|哪些|几|啥)|(?:还有|有没有).*(?:吗|呢|呀|啊)$|还有多少|有没有|还剩多少|查一下|看看|库存|有无|存量|how (much|many)|do we have/i,
    ],
    weight: 0.9,
  },
  {
    intent: 'SYSTEM_FEEDBACK',
    patterns: [
      /(?:大声|小声|停顿|标点|逗号|句号|分号|问号|感叹号|模型|识别|语音|语速|说话|声音|麦克风|听得清|听不清|听不懂|听得懂|老人|老年人|年纪大|慢点说|慢慢说|说话太快|句子|断句|你是谁|你叫什么|在吗|你好|早安|晚安|聊天|讲个笑话|谢谢|多谢|辛苦)/i,
    ],
    weight: 0.98,
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
  支: 'piece',
  条: 'piece',
  盒: 'box',
  瓶: 'bottle',
  罐: 'can',
  包: 'pack',
  袋: 'bag',
  份: 'pack',
  把: 'bunch',
  串: 'bunch',
  碗: 'bowl',
  勺: 'spoon',
  杯: 'cup',
  碟: 'piece',
  筐: 'box',
  篮: 'box',
  听: 'can',
  桶: 'bucket',
  克: 'g',
  g: 'g',
  千克: 'kg',
  公斤: 'kg',
  kg: 'kg',
  斤: 'jin',
  两: 'liang',
  毫升: 'ml',
  ml: 'ml',
  升: 'l',
  l: 'l',
};

const QUANTITY_PATTERN =
  /(\d+(?:\.\d+)?)\s*(千克|公斤|毫升|克|盒|瓶|罐|包|袋|把|个|只|颗|枚|根|片|块|段|支|条|份|串|斤|两|升|碗|勺|杯|碟|筐|篮|听|桶|kg|ml|g|l)/gi;

export const BATCH_COMMIT_PATTERN =
  /(?:以上全部|前面说的|就这些|全部入库|就这么多|记录完毕|好了|完事|没了|够了|全部添加)/i;

export function isReasonableUnitForFood(entry: FoodCatalogEntry, unit: string): boolean {
  // 用户通常按包装或日常规格录入食材（“一袋香菇”“两盒南乳”“一瓶红酒”）。
  // 零拦截策略：只要是合法的包装/通用量词（盒/袋/包/瓶/罐/个/斤/两），全量信任并放行，绝不说“请按克记录”。
  const suggested = suggestedUnitsForFood(entry);
  if (suggested.includes(unit)) return true;
  if (
    [
      'box',
      'bag',
      'pack',
      'bottle',
      'can',
      'piece',
      'jin',
      'liang',
      'bunch',
      'g',
      'kg',
      'bowl',
      'spoon',
      'cup',
      'bucket',
    ].includes(unit)
  ) {
    return true;
  }
  return false;
}

const SYSTEM_FEEDBACK_OR_CHAT =
  /(?:大声|小声|停顿|标点|逗号|句号|分号|问号|感叹号|模型|识别|语音|语速|说话|声音|麦克风|听得清|听不清|听不懂|听得懂|老人|老年人|年纪大|慢点说|慢慢说|说话太快|句子|断句|你是谁|你叫什么|在吗|你好|早安|晚安|聊天|讲个笑话|谢谢|多谢|辛苦)/i;
const INFORMATION_REQUEST = /请用\d+句|怎么|怎样|如何|做什么|介绍|告诉我|能否|能不能|是否|可以.+吗/;
const INVENTORY_CATEGORY_QUERY =
  /(?:有|剩)(?:哪些|什么)(?:肉类?|荤菜|蔬菜|青菜|菜类|水果|海鲜|水产|鱼虾|龙虾|贝类|蛋奶|奶制品|乳制品|蛋类|豆制品|主食|粮食|谷物|菌菇|蘑菇|调味料|调料|佐料)|(?:肉类?|荤菜|蔬菜|青菜|菜类|水果|海鲜|水产|鱼虾|龙虾|贝类|蛋奶|奶制品|乳制品|蛋类|豆制品|主食|粮食|谷物|菌菇|蘑菇|调味料|调料|佐料)(?:有|剩)(?:哪些|什么|多少)/;
const SIMPLE_CATEGORY_QUERY =
  /^(?:嗯|呃|那|请问|我们?|家里)?(?:有|有没有|还有|是否有)(?:没有)?(?:哪些|什么)?(?:肉类?|荤菜|蔬菜|青菜|菜类|水果|海鲜|水产|鱼虾|龙虾|贝类|蛋奶|奶制品|乳制品|蛋类|豆制品|主食|粮食|谷物|菌菇|蘑菇|调味料|调料|佐料)(?:吗|呢|呀|啊)?$/;
const INVENTORY_QUERY_REQUEST =
  /(?:冰箱|冷藏|冷冻|常温|库存|家里).*(?:有|剩|哪些|什么)|(?:我|我们)?(?:有|剩)(?:哪些|什么)食材|(?:有哪些|有什么|列出|盘点|查找|查询).*(?:食材|东西|菜)|(?:哪些|什么).*(?:快过期|临期|已经过期)|(?:快过期|临期|过期).*(?:哪些|什么)|(?:什么时候|哪天).*(?:到期|过期)|(?:今天|今晚|中午).*(?:吃什么|做什么菜|做点什么)|(?:这些|现有|冰箱里|库存里).*(?:能做|可以做|吃什么|怎么吃|美食|菜谱|减脂餐)|(?:减脂|减肥).*(?:餐|吃什么|怎么吃|推荐)|(?:还有|有没有|还剩).*(?:吗|呢|呀|啊)$/;
const MEAL_OR_SHOPPING_ADVICE_REQUEST =
  /(?:想吃|做).*(?:还要买|还缺|缺什么|买什么|怎么做)|(?:还要买|还缺|缺什么|买什么).*(?:菜|肉|汤|饭|牛腩|土豆)/;
const SNACK_RECOMMENDATION_REQUEST =
  /(?:下午茶|加餐|小点心|点心|零食).*(?:推荐|吃什么|有什么|做什么|怎么搭配|简单)|(?:推荐|吃什么|有什么|做什么|怎么搭配|简单).*(?:下午茶|加餐|小点心|点心|零食)/;
const MEAL_RECOMMENDATION_REQUEST =
  /(?:早餐|早饭|午餐|中饭|晚餐|晚饭|今晚|晚上|中午|夜宵|宵夜|家庭餐|家庭晚餐|全家|一个人|单人|独自吃|两个人|多人|几个人|[一二两三四五六七八九十\d]+(?:个)?人|聚会|一起吃).*(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|菜单|餐食|菜品|菜|简单|快手)|(?:推荐|吃什么|有什么|做什么|怎么搭配|搭配|菜单|餐食|菜品|菜|简单|快手).*(?:早餐|早饭|午餐|中饭|晚餐|晚饭|今晚|晚上|中午|夜宵|宵夜|家庭餐|家庭晚餐|全家|一个人|单人|独自吃|两个人|多人|几个人|聚会|一起吃)|(?:明天|后天|今天|今晚|早上|中午|晚上)?(?:早餐|早饭|午餐|中饭|晚餐|晚饭|下午茶|加餐|夜宵|宵夜|家庭餐|家庭晚餐|聚会).{0,24}(?:用餐|两个人|三个人|四个人|五个人|六个人|[一二两三四五六七八九十\d]+(?:个)?(?:人|位|口)|安排|准备)|(?:想吃|想要吃|吃什么|做什么).{0,30}(?:你来推荐|帮我推荐|你推荐|推荐一下|你安排|随便安排|帮我选)/;
const RECIPE_FOLLOW_UP_REQUEST =
  /食谱|菜谱|具体(?:的)?菜|菜单|餐食|菜品|执行方案|给我.*(?:一道|几个|几道).*菜|继续.*(?:刚才|上一个|前面).*(?:食谱|菜|推荐)|(?:还有|再来|换一个|换一道|重新).{0,12}(?:推荐|菜|餐|方案|菜单)|(?:少油|少盐|清淡|低脂|减脂|减肥).*(?:推荐|吃什么|做法|菜|餐|食谱|搭配|菜单)?|(?:推荐|吃什么|安排|搭配).*(?:清淡|少油|少盐|低脂|减脂|减肥)|(?:搭配|菜单|方案|推荐).*(?:不合理|不够|调整|修改)|(?:不合理|不够).*(?:调味料|食材|吃|人份|菜|餐|搭配)|(?:晚餐|午餐|早餐|下午茶|聚会|朋友来|家庭晚餐|晚上|今晚).*(?:食谱|菜谱|几道菜|搭配|菜单)/;
const MOVE_INVENTORY_REQUEST =
  /(?:移到|移去|挪到|转到|换到|放到|转入|挪入|移入).*(?:冷冻|冷库|冷柜|冰柜|冷藏|保鲜|常温|室温|橱柜|储物柜|储藏室)|(?:冷冻|冷库|冷柜|冰柜|冷藏|保鲜|常温|室温|橱柜|储物柜|储藏室).*(?:移|挪|转|换|放)|(?:把|将).*(?:挪|移|转|换).*(?:冷冻|冷库|冷柜|冰柜|冷藏|保鲜|常温|室温|橱柜|储物柜|储藏室)/;
const REMINDER_QUERY_REQUEST =
  /(?:今天|明天|后天|今晚).*(?:安排|计划|提醒).*(?:什么|哪些|啥|有没有|查看|看一下|查一下)|(?:查看|看一下|查一下|告诉我).*(?:今天|明天|后天|今晚).*(?:安排|计划|提醒)|(?:今天|明天|后天|今晚).*(?:有什么|有哪些).*(?:安排|计划|提醒)|(?:今天|明天|后天|今晚).*有(?:安排|计划|提醒)(?:吗|呢)/;
const EXPLICIT_COMPLETED_ACTION =
  /用了|用掉|吃了|吃掉|喝了|喝掉|炒了|煮了|做饭用了|做菜用了|做好了|买了|新买|购入|添加|加了|放进|入库|扔了|扔掉|丢了|丢掉|倒掉/;

/** 用户陈述“冰箱里有三颗西瓜”时，视为待确认的入库候选，而不是库存查询。 */
const INVENTORY_DECLARATION =
  /^(?:嗯|呃|那个|好的)?(?:我)?(?:家里|冰箱)(?:里|里面)?有(?:\d|[一二两俩三四五六七八九十百千半])/;

/** 将自然语言存放位置转为稳定区域代码；实际 zone id 由 Interaction 模块按家庭查询。 */
export function requestedStorageZoneCode(
  normalized: string,
): 'FRIDGE' | 'FREEZER' | 'PANTRY' | null {
  if (/冷冻|冷库|冷柜|冰柜/.test(normalized)) return 'FREEZER';
  if (/冷藏|保鲜/.test(normalized)) return 'FRIDGE';
  if (/常温|室温|橱柜|储物柜|储藏室/.test(normalized)) return 'PANTRY';
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
  const last = all[all.length - 1];
  if (last) return last;
  // 口语尾音截断与补字容错："只用掉一"、"只要一"、"吃了一" -> 取数值 1
  const m =
    /(?:只(?:有|用掉|吃了|要|换成|变成|改|改成)?|用掉|只|改)\s*([一二两三四五六七八九十\d]+)$/.exec(
      normalized.trim(),
    );
  if (m && m[1]) {
    const numMap: Record<string, string> = {
      一: '1',
      二: '2',
      两: '2',
      三: '3',
      四: '4',
      五: '5',
      六: '6',
      七: '7',
      八: '8',
      九: '9',
      十: '10',
    };
    const val = numMap[m[1]] ?? m[1];
    return { quantity: val, unit: '' };
  }
  return null;
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
  if (
    /(?:把|将)?.*(?:加入|加到|添加到|记在|记入|列入).*(?:购物清单|待购清单)|(?:购物清单|待购清单).*(?:加|添加|买)/.test(
      normalized,
    )
  ) {
    return { intent: 'ADD_SHOPPING_ITEM', confidence: 0.98 };
  }
  if (
    /(?:看看|查看|查询|读一下)?(?:购物清单|待购清单).*(?:有什么|有哪些|是什么|内容)|(?:购物清单|待购清单)$/.test(
      normalized,
    )
  ) {
    return { intent: 'QUERY_SHOPPING_LIST', confidence: 0.98 };
  }
  if (/(?:帮我|替我|给我|在外卖上).*(?:下单|购买|网上买)|(?:下单|网购|外卖).*(?:买|购买)?/.test(normalized)) {
    return { intent: 'EXTERNAL_PURCHASE', confidence: 0.98 };
  }
  if (INVENTORY_DECLARATION.test(normalized)) {
    return { intent: 'ADD_INVENTORY', confidence: 0.9 };
  }
  if (MOVE_INVENTORY_REQUEST.test(normalized)) {
    return { intent: 'MOVE_INVENTORY', confidence: 0.96 };
  }
  if (
    /(?:教我做|怎么做|教教我做|开始做|带我做|制作教程|烹饪教程|做菜步骤|第[一1]步怎么做|怎么炒|怎么煮|怎么蒸|具体怎么做)/.test(
      normalized,
    )
  ) {
    return { intent: 'KITCHEN_START_TUTORIAL', confidence: 0.99 };
  }
  if (SNACK_RECOMMENDATION_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.92 };
  }
  if (
    MEAL_RECOMMENDATION_REQUEST.test(normalized) &&
    !EXPLICIT_COMPLETED_ACTION.test(normalized) &&
    !/(?:用掉|吃了|喝了|做饭用了|炒了|煮了|消耗|买了|添加|加了|存了|放进|扔了|倒了)/.test(normalized)
  ) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.92 };
  }
  if (RECIPE_FOLLOW_UP_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.9 };
  }
  if (MEAL_OR_SHOPPING_ADVICE_REQUEST.test(normalized)) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.88 };
  }
  if (
    INVENTORY_QUERY_REQUEST.test(normalized) ||
    INVENTORY_CATEGORY_QUERY.test(normalized) ||
    SIMPLE_CATEGORY_QUERY.test(normalized)
  ) {
    return { intent: 'QUERY_INVENTORY', confidence: 0.95 };
  }
  if (SYSTEM_FEEDBACK_OR_CHAT.test(normalized)) {
    return { intent: 'SYSTEM_FEEDBACK', confidence: 0.98 };
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
      const lowerName = name.toLowerCase();
      let index = normalized.toLowerCase().indexOf(lowerName);
      while (index !== -1) {
        matches.push({ entry, index, matchedText: name });
        index = normalized.toLowerCase().indexOf(lowerName, index + lowerName.length);
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

    // 1. 前置紧邻（间隔 <= 5，容忍 "的"、"那个"、空格等口语填充词）
    const before = quantityMatches
      .filter((q) => !q.used && q.end <= foodStart && foodStart - q.end <= 5)
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
    unit_reasonable: isReasonableUnitForFood(match.entry, unit),
    suggested_units: suggestedUnits,
  };
}

export interface ExtractedSlots {
  items: ParsedItem[];
  standaloneQuantities: { quantity: string; unit: string }[];
}

/**
 * 仅用于多轮澄清阶段的槽位提取，不进行全句的意图推断。
 * 能够提取出完整的食材列表，以及孤立的（未匹配到食材的）数量，供外层继承。
 */
export function extractSlots(normalized: string, catalog: FoodCatalogEntry[]): ExtractedSlots {
  const foodMatches = matchFoods(normalized, catalog);
  const quantityMatches = collectQuantityMatches(normalized);
  const items = assignQuantities(normalized, foodMatches, quantityMatches);

  const standaloneQuantities = quantityMatches
    .filter((q) => !q.used)
    .map((q) => ({ quantity: q.quantity, unit: q.unit ?? '' }));

  return { items, standaloneQuantities };
}

export function parseTranscript(normalized: string, catalog: FoodCatalogEntry[]): ParseResult {
  const detected = detectIntent(normalized);
  let intent = detected.intent;
  let intentConfidence = detected.confidence;
  const foodMatches = matchFoods(normalized, catalog);
  const quantityMatches = collectQuantityMatches(normalized);
  let items = assignQuantities(normalized, foodMatches, quantityMatches);

  // 语法级别 Fallback 实体提取器：
  // 当用户在语句中表达了【数量+单位】（如“500克”或“两包”），但未能精准命中知识库标准词时，
  // 动态从数量之后抽取紧随的名词（如“500克的排骨”中的“排骨”），防止将有效食材丢弃导致降级错乱。
  const unusedQuantities = quantityMatches.filter((q) => !q.used);
  if (unusedQuantities.length > 0) {
    for (const q of unusedQuantities) {
      const sub = normalized.slice(q.end);
      const m = /^\s*(?:的)?\s*([\u4e00-\u9fa5a-zA-Z0-9]{1,8})/.exec(sub);
      if (m && m[1]) {
        const rawName = m[1]
          .replace(/^(?:然后|接着|再|帮我|入库|添加|放进|买|买了|是|改成|换成|变成)+/, '')
          .replace(
            /(?:帮我|帮忙|记录|添加|入库|放进|买|买下|买来|然后|接着|再|用掉|吃掉|的|了|把).*$/,
            '',
          )
          .trim();
        if (
          rawName &&
          rawName.length >= 1 &&
          !/^(?:的|了|一下|看看|吧|啊|呢|吗|对|不对|取消|算了)$/.test(rawName) &&
          // 修正话术残片（"不是2盒是3盒" 里的 "是3盒"→剥掉"是"后是纯数量），不是食材名
          !/^\d/.test(rawName) &&
          // 标点符号、断句、语音术语、反馈词汇不是食材名！
          !/^(?:停顿|标点|逗号|句号|分号|问号|感叹号|句子|段落|模型|识别|语音|话术|词语|字|声音|老人|老年人)/.test(
            rawName,
          ) &&
          // 量词性名词（"两个人"的"人"、"三位"的"位"）和泛指代词（"东西"、"物品"）不是食材
          !/^(?:人|人份|位|口|天|次|小时|分钟|东西|物品|其它|其他)/.test(rawName)
        ) {
          // 先精确匹配，再拼音模糊匹配
          let catalogHit = catalog.find(
            (c) => c.canonicalName.includes(rawName) || rawName.includes(c.canonicalName),
          );
          // 拼音模糊匹配 fallback：当精确匹配失败时，用拼音相似度查找最佳候选
          if (!catalogHit && rawName.length >= 2) {
            const catalogNames = catalog.flatMap((c) => [
              { name: c.canonicalName, id: c.id, canonicalName: c.canonicalName },
              ...c.aliases.map((a) => ({ name: a, id: c.id, canonicalName: c.canonicalName })),
            ]);
            const phoneticHit = phoneticFoodMatch(rawName, catalogNames, 0.8);
            if (phoneticHit) {
              catalogHit = catalog.find((c) => c.id === phoneticHit.id);
            }
          }
          items.push({
            food_id: catalogHit ? catalogHit.id : `custom_${rawName}`,
            food_name: catalogHit ? catalogHit.canonicalName : rawName,
            quantity: q.quantity,
            unit: q.unit ?? (catalogHit ? catalogHit.defaultUnitCode : 'piece'),
            quantity_explicit: true,
            unit_reasonable: catalogHit
              ? isReasonableUnitForFood(catalogHit, q.unit ?? 'piece')
              : true,
            suggested_units: catalogHit ? suggestedUnitsForFood(catalogHit) : [q.unit ?? 'piece'],
          });
          q.used = true;
        }
      }
    }
  }

  // 强去重与合并机制：同一个 food_id / food_name 绝对只保留一份（显式数量优先，后出现的覆盖先出现的）
  const deduplicated: ParsedItem[] = [];
  for (const item of items) {
    const existingIndex = deduplicated.findIndex(
      (d) => d.food_id === item.food_id || d.food_name === item.food_name,
    );
    if (existingIndex === -1) {
      deduplicated.push(item);
    } else {
      const existing = deduplicated[existingIndex];
      if (existing && (item.quantity_explicit || !existing.quantity_explicit)) {
        deduplicated[existingIndex] = item;
      }
    }
  }
  items = deduplicated;

  if (intent === 'SYSTEM_FEEDBACK') {
    items = [];
  }

  // 裸声明默认入库：用户列货时常省略动词（"薏米一盒"、"两盒南乳"、"6斤腊肉"）。
  // 当没有识别到动作意图、但已解析出【带明确数量单位的目录食材】时，默认按添加候选处理，
  // 仍会经确认卡兜底，避免像 07/22 段4 那样对每一句都追问"是要添加、用掉还是查询"。
  if (
    intent === 'UNKNOWN' &&
    items.length > 0 &&
    items.every((item) => item.quantity_explicit && !item.food_id.startsWith('custom_')) &&
    // 排除信息/菜谱类问句（"怎么用两个鸡蛋做菜"、"…做什么"、"…吗"），这类不是入库
    !INFORMATION_REQUEST.test(normalized) &&
    !/做菜|做什么菜|怎么做|食谱|菜谱|推荐|吗\s*$|呢\s*$/.test(normalized)
  ) {
    intent = 'ADD_INVENTORY';
    intentConfidence = 0.7;
  }

  const catalogMatched = items.some((item) => !item.food_id.startsWith('custom_'));
  const foodConfidence = catalogMatched ? 0.95 : items.length > 0 ? 0.4 : 0;
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
