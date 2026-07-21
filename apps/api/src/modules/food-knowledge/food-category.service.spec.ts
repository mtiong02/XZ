import { describe, expect, it } from 'vitest';
import { matchFoodCategories, type FoodCategoryDictionaryEntry } from './food-category.service';

const categories: FoodCategoryDictionaryEntry[] = [
  { code: 'MEAT', nameZh: '肉类', aliases: ['肉', '肉类', '荤菜'] },
  { code: 'AQUATIC', nameZh: '水产海鲜', aliases: ['海鲜', '水产', '鱼虾'] },
  { code: 'CRUSTACEAN', nameZh: '甲壳类', aliases: ['甲壳类', '虾蟹'] },
  { code: 'LOBSTER', nameZh: '龙虾类', aliases: ['龙虾', '龙虾类'] },
  { code: 'SEASONING', nameZh: '调味料', aliases: ['调味料', '调料', '佐料'] },
];

describe('matchFoodCategories', () => {
  it('matches a broad spoken category', () => {
    expect(matchFoodCategories('我们现在还有哪些肉', categories)).toEqual([
      { code: 'MEAT', nameZh: '肉类' },
    ]);
  });

  it('supports extensible nested categories without adding parser rules', () => {
    expect(matchFoodCategories('冰箱里还有什么龙虾', categories)).toEqual([
      { code: 'LOBSTER', nameZh: '龙虾类' },
    ]);
  });

  it('keeps distinct requested categories and ignores duplicate aliases', () => {
    expect(matchFoodCategories('看看海鲜水产和调味料', categories)).toEqual([
      { code: 'AQUATIC', nameZh: '水产海鲜' },
      { code: 'SEASONING', nameZh: '调味料' },
    ]);
  });

  it('does not infer a category that was not spoken', () => {
    expect(matchFoodCategories('我还有什么食材', categories)).toEqual([]);
  });
});
