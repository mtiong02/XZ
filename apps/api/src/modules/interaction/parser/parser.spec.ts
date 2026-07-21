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
  { id: 'f-spinach', canonicalName: '菠菜', defaultUnitCode: 'g', aliases: ['spinach'] },
  { id: 'f-pork', canonicalName: '猪肉', defaultUnitCode: 'g', aliases: ['pork'] },
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
  // 斤 -> 500g
  {
    text: '买了一斤猪肉',
    intent: 'ADD_INVENTORY',
    items: [{ food_id: 'f-pork', quantity: '500', unit: 'g' }],
  },
  // 丢弃
  {
    text: '菠菜坏了扔了300克',
    intent: 'DISCARD_INVENTORY',
    items: [{ food_id: 'f-spinach', quantity: '300', unit: 'g' }],
  },
  // 查询
  { text: '看看还有多少鸡蛋', intent: 'QUERY_INVENTORY' },
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
});
