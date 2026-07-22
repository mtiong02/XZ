import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from './normalizer';
import { parseTranscript, type FoodCatalogEntry } from './intent-parser';

/**
 * 语音解析评估用例（docs/05 §3-4 的最小可执行子集）。
 * 覆盖：普通话、英文、中英混合、中文数字、量词、多食材、意图区分。
 * 完整 300 条评估集在种子测试前由语料任务补齐。
 */

const catalog: FoodCatalogEntry[] = [
  { id: 'f-egg', canonicalName: '鸡蛋', defaultUnitCode: 'piece', aliases: ['蛋', 'egg', 'eggs'] },
  { id: 'f-milk', canonicalName: '牛奶', defaultUnitCode: 'box', aliases: ['鲜奶', 'milk'] },
  {
    id: 'f-tomato',
    canonicalName: '西红柿',
    defaultUnitCode: 'piece',
    aliases: ['番茄', 'tomato'],
  },
  {
    id: 'f-spinach',
    canonicalName: '菠菜',
    category: 'VEGETABLE',
    defaultUnitCode: 'g',
    preferredUnitCodes: ['bunch', 'jin', 'g', 'kg'],
    aliases: ['spinach'],
  },
  {
    id: 'f-pork',
    canonicalName: '猪肉',
    category: 'MEAT',
    defaultUnitCode: 'g',
    preferredUnitCodes: ['jin', 'g', 'kg'],
    aliases: ['pork'],
  },
  {
    id: 'f-potato',
    canonicalName: '土豆',
    category: 'VEGETABLE',
    defaultUnitCode: 'piece',
    preferredUnitCodes: ['piece', 'jin', 'g', 'kg'],
    aliases: ['马铃薯'],
  },
  { id: 'f-bread', canonicalName: '面包', defaultUnitCode: 'pack', aliases: ['吐司'] },
];

interface EvalCase {
  text: string;
  intent: string;
  items?: { food_id: string; quantity: string; unit: string }[];
}

const cases: EvalCase[] = [
  // 普通话添加
  {
    text: '刚买了两盒牛奶和十个鸡蛋',
    intent: 'ADD_INVENTORY',
    items: [
      { food_id: 'f-milk', quantity: '2', unit: 'box' },
      { food_id: 'f-egg', quantity: '10', unit: 'piece' },
    ],
  },
  {
    text: '买了3个西红柿',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-tomato', quantity: '3', unit: 'piece' }],
  },
  // 别名
  {
    text: '加了两个番茄',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-tomato', quantity: '2', unit: 'piece' }],
  },
  // 使用
  {
    text: '午饭用了2个鸡蛋和一个西红柿',
    intent: 'CONSUME_INVENTORY',
    items: [
      { food_id: 'f-egg', quantity: '2', unit: 'piece' },
      { food_id: 'f-tomato', quantity: '1', unit: 'piece' },
    ],
  },
  {
    text: '喝了一盒牛奶',
    intent: 'CONSUME_INVENTORY',
    items: [{ food_id: 'f-milk', quantity: '1', unit: 'box' }],
  },
  // 斤保留在候选中以便自然复述，执行库存命令时统一换算为克
  {
    text: '买了一斤猪肉',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-pork', quantity: '1', unit: 'jin' }],
  },
  {
    text: '土豆买了三斤',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-potato', quantity: '3', unit: 'jin' }],
  },
  {
    text: '买了两把菠菜',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-spinach', quantity: '2', unit: 'bunch' }],
  },
  {
    text: '买了2000克菠菜',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-spinach', quantity: '2000', unit: 'g' }],
  },
  // 丢弃
  {
    text: '菠菜坏了扔了300克',
    intent: 'DISCARD_INVENTORY',
    items: [{ food_id: 'f-spinach', quantity: '300', unit: 'g' }],
  },
  // 查询
  { text: '看看还有多少鸡蛋', intent: 'QUERY_INVENTORY' },
  { text: '我有哪些食材', intent: 'QUERY_INVENTORY' },
  { text: '冰箱里有什么', intent: 'QUERY_INVENTORY' },
  { text: '冷冷冻区有什么东西啊', intent: 'QUERY_INVENTORY' },
  { text: '我们现在还有哪些肉', intent: 'QUERY_INVENTORY' },
  { text: '还剩什么蔬菜', intent: 'QUERY_INVENTORY' },
  { text: '现在还有哪些调味料', intent: 'QUERY_INVENTORY' },
  { text: '哪些东西快过期了', intent: 'QUERY_INVENTORY' },
  { text: '今天吃什么', intent: 'QUERY_INVENTORY' },
  { text: '这些食材能够做什么美食', intent: 'QUERY_INVENTORY' },
  { text: '结合冰箱现有食物推荐一些减脂餐', intent: 'QUERY_INVENTORY' },
  { text: '这些食物可以吃什么样的减脂餐', intent: 'QUERY_INVENTORY' },
  { text: '帮我下单买一些面包', intent: 'EXTERNAL_PURCHASE' },
  { text: '帮我下单买一些面包冰箱里面没有面包', intent: 'EXTERNAL_PURCHASE' },
  { text: '把面包加入购物清单', intent: 'ADD_SHOPPING_ITEM' },
  { text: '购物清单加一包面包', intent: 'ADD_SHOPPING_ITEM' },
  { text: '查看购物清单有什么', intent: 'QUERY_SHOPPING_LIST' },
  { text: '我明天安排了什么会吃掉啊你看一下', intent: 'QUERY_REMINDERS' },
  { text: '明天有什么提醒吗', intent: 'QUERY_REMINDERS' },
  { text: '请提醒一下我明天要把猪肉全部吃完', intent: 'CREATE_REMINDER' },
  { text: '提醒我明天中午把猪肉吃了', intent: 'CREATE_REMINDER' },
  { text: '明天中午提醒我吃掉猪肉', intent: 'CREATE_REMINDER' },
  { text: '帮我定一个提醒吧明天买绿叶菜', intent: 'CREATE_REMINDER' },
  { text: '设置一个提醒明天购买蔬菜', intent: 'CREATE_REMINDER' },
  {
    text: '民天中午十二点提醒我吃掉一千克的猪肉',
    intent: 'CREATE_REMINDER',
    items: [{ food_id: 'f-pork', quantity: '1', unit: 'kg' }],
  },
  // 英文
  {
    text: 'bought 6 eggs',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-egg', quantity: '6', unit: 'piece' }],
  },
  // 中英混合
  {
    text: '买了2盒milk',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-milk', quantity: '2', unit: 'box' }],
  },
  // 无法识别
  { text: '今天天气不错', intent: 'UNKNOWN' },
  { text: '请用三句话介绍你能怎样管理土豆、菠菜和牛奶', intent: 'UNKNOWN' },
  { text: '怎么用两个鸡蛋做菜', intent: 'UNKNOWN' },
];

describe('normalizeTranscript', () => {
  it('converts Chinese numerals to digits', () => {
    expect(normalizeTranscript('两盒牛奶和十个鸡蛋')).toBe('2盒牛奶和10个鸡蛋');
    expect(normalizeTranscript('二十五个')).toBe('25个');
    expect(normalizeTranscript('半盒')).toBe('0.5盒');
  });

  it('normalizes fullwidth digits and whitespace', () => {
    expect(normalizeTranscript('　３　盒 牛奶 ')).toBe('3 盒 牛奶');
  });
});

describe('parseTranscript evaluation set', () => {
  for (const evalCase of cases) {
    it(`"${evalCase.text}" -> ${evalCase.intent}`, () => {
      const normalized = normalizeTranscript(evalCase.text);
      const result = parseTranscript(normalized, catalog);
      expect(result.intent).toBe(evalCase.intent);
      if (evalCase.items) {
        expect(
          result.items.map((item) => ({
            food_id: item.food_id,
            quantity: item.quantity,
            unit: item.unit,
          })),
        ).toEqual(evalCase.items);
      }
    });
  }

  it('flags implicit quantity with low quantity confidence', () => {
    const result = parseTranscript(normalizeTranscript('用了鸡蛋'), catalog);
    expect(result.intent).toBe('CONSUME_INVENTORY');
    expect(result.items[0]?.quantity_explicit).toBe(false);
    expect(result.confidence.quantity).toBeLessThan(0.9);
  });

  it('never returns high overall confidence without a food match', () => {
    const result = parseTranscript(normalizeTranscript('买了一些东西'), catalog);
    expect(result.confidence.overall).toBeLessThan(0.5);
  });

  it('marks an implausible food/unit pair for clarification', () => {
    const result = parseTranscript(normalizeTranscript('买了三瓶土豆'), catalog);
    expect(result.items[0]?.unit_reasonable).toBe(false);
    expect(result.items[0]?.suggested_units).toEqual(['piece', 'jin', 'g', 'kg']);
  });
});
