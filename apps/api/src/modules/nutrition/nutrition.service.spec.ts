import { describe, expect, it } from 'vitest';
import { buildNutritionObservations, nutritionGroupForCategory } from './nutrition.service';

describe('nutritionGroupForCategory', () => {
  it.each([
    ['PORK', 'PROTEIN'],
    ['FISH', 'SEAFOOD'],
    ['LEAFY_VEGETABLE', 'VEGETABLE'],
    ['CITRUS_FRUIT', 'FRUIT'],
    ['ROOT_TUBER', 'STAPLE'],
    ['LIQUID_DAIRY', 'DAIRY'],
    ['LEGUME', 'LEGUME'],
    ['TREE_NUT', 'HEALTHY_FAT'],
  ])('maps %s to %s', (category, expected) => {
    expect(nutritionGroupForCategory(category)).toBe(expected);
  });

  it('falls back to other for unknown categories', () => {
    expect(nutritionGroupForCategory('UNCLASSIFIED')).toBe('OTHER');
  });

  it('reports category gaps without pretending to know actual intake', () => {
    const observations = buildNutritionObservations([
      {
        code: 'PROTEIN',
        label: '蛋白质来源',
        present: true,
        food_count: 1,
        foods: ['猪肉'],
      },
      {
        code: 'VEGETABLE',
        label: '蔬菜',
        present: false,
        food_count: 0,
        foods: [],
      },
      {
        code: 'FRUIT',
        label: '水果',
        present: false,
        food_count: 0,
        foods: [],
      },
      {
        code: 'STAPLE',
        label: '主食与碳水',
        present: false,
        food_count: 0,
        foods: [],
      },
    ]);
    expect(observations.map((observation) => observation.code)).toEqual(
      expect.arrayContaining(['PROTEIN_PRESENT', 'VEGETABLE_GAP', 'FRUIT_GAP', 'STAPLE_GAP']),
    );
    expect(observations.every((observation) => !observation.detail.includes('已经摄入'))).toBe(
      true,
    );
  });

  it('recognizes seafood, dairy and legumes as valid protein sources', () => {
    const observations = buildNutritionObservations([
      { code: 'PROTEIN', label: '蛋白质来源', present: false, food_count: 0, foods: [] },
      { code: 'SEAFOOD', label: '海鲜水产', present: true, food_count: 1, foods: ['鲈鱼'] },
      { code: 'DAIRY', label: '奶类', present: false, food_count: 0, foods: [] },
      { code: 'LEGUME', label: '豆类', present: false, food_count: 0, foods: [] },
    ]);
    expect(observations.find((item) => item.code === 'PROTEIN_PRESENT')?.evidence_foods).toEqual([
      '鲈鱼',
    ]);
    expect(observations.some((item) => item.code === 'PROTEIN_GAP')).toBe(false);
  });
});
