import { describe, expect, it } from 'vitest';
import {
  buildAfternoonTeaRecommendation,
  buildMealContextRecommendation,
  parseMealContext,
} from './meal-recommendations';

describe('buildAfternoonTeaRecommendation', () => {
  it('uses existing fruit and yogurt without suggesting inventory consumption', () => {
    expect(
      buildAfternoonTeaRecommendation([{ name: '酸奶' }, { name: '苹果' }, { name: '西瓜' }]),
    ).toContain('苹果酸奶杯');
    expect(
      buildAfternoonTeaRecommendation([{ name: '酸奶' }, { name: '苹果' }]),
    ).toContain('不会自动扣减库存');
  });

  it('does not suggest raw meat as an afternoon snack', () => {
    expect(buildAfternoonTeaRecommendation([{ name: '鸡胸肉' }, { name: '猪肉' }])).toContain(
      '暂时没有特别适合快速下午茶',
    );
  });

  it('understands occasion, diners and meal preferences before choosing a recipe', () => {
    expect(parseMealContext('今晚四个人家庭晚餐，简单一点，想吃减脂餐')).toMatchObject({
      occasion: 'DINNER', dinerCount: 4, diningMode: 'FAMILY', wantsQuick: true, weightConscious: true,
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
});
