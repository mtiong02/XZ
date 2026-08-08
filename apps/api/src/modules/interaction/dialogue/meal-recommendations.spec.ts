import { describe, expect, it } from 'vitest';
import {
  buildAfternoonTeaRecommendation,
  buildMealContextRecommendation,
  normalizeBareDinerReply,
  parseMealContext,
} from './meal-recommendations';

describe('buildAfternoonTeaRecommendation', () => {
  it('uses existing fruit and yogurt without suggesting inventory consumption', () => {
    expect(
      buildAfternoonTeaRecommendation([{ name: '酸奶' }, { name: '苹果' }, { name: '西瓜' }]),
    ).toContain('苹果酸奶杯');
    expect(buildAfternoonTeaRecommendation([{ name: '酸奶' }, { name: '苹果' }])).toContain(
      '不会自动扣减库存',
    );
  });

  it('does not suggest raw meat as an afternoon snack', () => {
    expect(buildAfternoonTeaRecommendation([{ name: '鸡胸肉' }, { name: '猪肉' }])).toContain(
      '暂时没有特别适合快速下午茶',
    );
  });

  it('understands occasion, diners and meal preferences before choosing a recipe', () => {
    expect(parseMealContext('今晚四个人家庭晚餐，简单一点，想吃减脂餐')).toMatchObject({
      occasion: 'DINNER',
      dinerCount: 4,
      diningMode: 'FAMILY',
      wantsQuick: true,
      weightConscious: true,
    });
    expect(
      buildMealContextRecommendation(
        parseMealContext('今晚四个人家庭晚餐，简单一点，想吃减脂餐'),
        [{ name: '鲈鱼' }],
        [{ name: '清蒸鲈鱼', servings: 2, can_make: true, coverage: 1, missing: [] }],
        3,
      ),
    ).toContain('约2.0倍备料');
  });

  it('keeps tomorrow breakfast and diner count as temporary task context', () => {
    expect(parseMealContext('明天早餐，两个人')).toMatchObject({
      occasion: 'BREAKFAST',
      dateReference: 'TOMORROW',
      dinerCount: 2,
    });
  });

  it('offers a multi-dish menu for a gathering instead of collapsing to one recipe', () => {
    const answer = buildMealContextRecommendation(
      parseMealContext('周末六个人朋友聚会，按冰箱食材推荐几道菜'),
      [{ name: '鲈鱼' }, { name: '牛肉' }, { name: '土豆' }, { name: '鸡蛋' }],
      [
        { name: '清蒸鲈鱼', servings: 2, can_make: true, coverage: 1, missing: [] },
        { name: '牛肉炖土豆', servings: 2, can_make: true, coverage: 1, missing: [] },
        { name: '鸡蛋羹', servings: 2, can_make: true, coverage: 1, missing: [] },
      ],
      3,
    );
    expect(answer).toContain('3道菜');
    expect(answer).toContain('清蒸鲈鱼、牛肉炖土豆、鸡蛋羹');
    expect(answer).toContain('6人');
  });

  it('recognizes natural spoken group dining without an explicit dinner word', () => {
    expect(parseMealContext('今天下午要跟五个人一起吃吃有什么推荐的菜')).toMatchObject({
      dinerCount: 5,
      diningMode: 'GATHERING',
    });
    expect(parseMealContext('搭配一下今天晚上的菜')).toMatchObject({ occasion: 'DINNER' });
  });

  it('keeps a solo diner as temporary request context', () => {
    expect(parseMealContext('今天只有我一个人吃')).toMatchObject({
      dinerCount: 1,
      diningMode: 'SOLO',
    });
    expect(parseMealContext('嗯我想一个人吃的就可以了')).toMatchObject({
      dinerCount: 1,
      diningMode: 'SOLO',
    });
    expect(parseMealContext('呃我一个人吃然后我对口味没有什么要求也没有忌口')).toMatchObject({
      dinerCount: 1,
      diningMode: 'SOLO',
    });
    expect(parseMealContext('1个人')).toMatchObject({
      dinerCount: 1,
      diningMode: 'SOLO',
    });
    expect(parseMealContext('就我一个人吃就可以了就我一个人吃')).toMatchObject({
      dinerCount: 1,
      diningMode: 'SOLO',
    });
  });

  it('normalizes various solo and bare diner spoken replies', () => {
    expect(normalizeBareDinerReply('就我一个人吃就可以了就我一个人吃')).toBe('1个人');
    expect(normalizeBareDinerReply('就我一个')).toBe('1个人');
    expect(normalizeBareDinerReply('单人')).toBe('1个人');
    expect(normalizeBareDinerReply('一个人')).toBe('1个人');
  });

  it('provides safe stock-based fallback for simple pantry ingredients like eggs and potatoes', () => {
    const answer = buildMealContextRecommendation(
      parseMealContext('就我一个人吃'),
      [{ name: '鸡蛋' }, { name: '土豆' }, { name: '鸭蛋' }],
      [],
      1,
    );
    expect(answer).toContain('土豆炒蛋');
    expect(answer).toContain('不会自动扣减');
  });
});

