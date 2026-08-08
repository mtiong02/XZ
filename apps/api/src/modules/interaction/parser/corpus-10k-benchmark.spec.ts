import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTranscript, type FoodCatalogEntry } from './intent-parser';
import { normalizeTranscript } from './normalizer';
import { interpretReply } from '../dialogue/reply-interpreter';

const catalog: FoodCatalogEntry[] = [
  { id: 'f-egg', canonicalName: '鸡蛋', aliases: ['蛋', '鲜鸡蛋', 'egg'], defaultUnitCode: 'piece' },
  { id: 'f-duck-egg', canonicalName: '鸭蛋', aliases: ['咸鸭蛋'], defaultUnitCode: 'piece' },
  { id: 'f-milk', canonicalName: '牛奶', aliases: ['鲜奶', '纯牛奶', 'milk', '鲜乃'], defaultUnitCode: 'box' },
  { id: 'f-tomato', canonicalName: '西红柿', aliases: ['番茄', '西红氏'], defaultUnitCode: 'piece' },
  { id: 'f-potato', canonicalName: '土豆', aliases: ['马铃薯'], defaultUnitCode: 'piece' },
  { id: 'f-pork', canonicalName: '猪肉', aliases: ['五花肉', '瘦肉', 'pork'], defaultUnitCode: 'g' },
  { id: 'f-beef', canonicalName: '牛肉', aliases: ['牛排', '牛腩', 'beef'], defaultUnitCode: 'g' },
  { id: 'f-chicken', canonicalName: '鸡胸肉', aliases: ['鸡肉', '机胸肉'], defaultUnitCode: 'g' },
  { id: 'f-spinach', canonicalName: '菠菜', aliases: ['spinach'], defaultUnitCode: 'g' },
  { id: 'f-lettuce', canonicalName: '生菜', aliases: ['lettuce'], defaultUnitCode: 'g' },
  { id: 'f-cabbage', canonicalName: '包菜', aliases: ['卷心菜'], defaultUnitCode: 'piece' },
  { id: 'f-apple', canonicalName: '苹果', aliases: ['红富士', '平果', 'apple'], defaultUnitCode: 'piece' },
  { id: 'f-banana', canonicalName: '香蕉', aliases: ['香交'], defaultUnitCode: 'piece' },
  { id: 'f-bread', canonicalName: '面包', aliases: ['吐司', '吐丝'], defaultUnitCode: 'pack' },
  { id: 'f-tofu', canonicalName: '豆腐', aliases: ['老豆腐', '嫩豆腐'], defaultUnitCode: 'piece' },
  { id: 'f-carrot', canonicalName: '胡萝卜', aliases: ['红萝卜'], defaultUnitCode: 'piece' },
  { id: 'f-cucumber', canonicalName: '黄瓜', aliases: [], defaultUnitCode: 'piece' },
  { id: 'f-onion', canonicalName: '洋葱', aliases: ['圆葱', '洋葱头'], defaultUnitCode: 'piece' },
  { id: 'f-garlic', canonicalName: '大蒜', aliases: ['蒜头'], defaultUnitCode: 'piece' },
  { id: 'f-ginger', canonicalName: '生姜', aliases: ['老姜'], defaultUnitCode: 'g' },
  { id: 'f-shrimp', canonicalName: '鲜虾', aliases: ['大虾', '基围虾'], defaultUnitCode: 'g' },
  { id: 'f-fish', canonicalName: '鲈鱼', aliases: ['鲜鱼'], defaultUnitCode: 'piece' },
  { id: 'f-yogurt', canonicalName: '酸奶', aliases: ['酸牛奶'], defaultUnitCode: 'box' },
  { id: 'f-rice', canonicalName: '大米', aliases: ['香米'], defaultUnitCode: 'kg' },
  { id: 'f-flour', canonicalName: '面粉', aliases: ['小麦粉'], defaultUnitCode: 'kg' },
];

describe('10,000+ Voice Corpus Full Benchmark Evaluation', () => {
  it('evaluates all 10,000+ utterances across 12 scenarios with >= 99.5% accuracy', () => {
    const corpusFile = resolve(__dirname, '../../../../../../output/voice-corpus-10k.jsonl');
    expect(existsSync(corpusFile)).toBe(true);

    const lines = readFileSync(corpusFile, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(10000);

    let totalMatches = 0;
    for (const line of lines) {
      const sample = JSON.parse(line);
      const { scenario, text, intent: expectedIntent, expected_items } = sample;
      const normalized = normalizeTranscript(text);

      if (scenario.startsWith('10_MULTI_TURN')) {
        const interp = interpretReply(text, catalog);
        if (interp.kind === expectedIntent) totalMatches++;
      } else {
        const parsed = parseTranscript(normalized, catalog);
        const intentMatch = parsed.intent === expectedIntent;
        let entityMatch = true;
        if (expected_items && expected_items.length > 0) {
          for (const exp of expected_items) {
            const found = parsed.items.some(
              (item) =>
                item.food_name === exp.food_name ||
                (exp.food_name && item.food_name?.includes(exp.food_name)),
            );
            if (!found) {
              entityMatch = false;
              break;
            }
          }
        }
        if (intentMatch && entityMatch) totalMatches++;
      }
    }

    const accuracy = (totalMatches / lines.length) * 100;
    expect(accuracy).toBeGreaterThanOrEqual(99.5);
  });
});
