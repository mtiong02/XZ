import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { InventoryItemView } from '@xz/contracts';
import { PG_POOL } from '../../infra/db/database.module';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';

export type NutritionGroupCode =
  | 'PROTEIN'
  | 'VEGETABLE'
  | 'FRUIT'
  | 'STAPLE'
  | 'DAIRY'
  | 'LEGUME'
  | 'HEALTHY_FAT'
  | 'SEAFOOD'
  | 'SEASONING'
  | 'OTHER';

export interface NutritionGroupSummary {
  code: NutritionGroupCode;
  label: string;
  present: boolean;
  food_count: number;
  foods: string[];
}

export interface NutritionObservation {
  code: string;
  severity: 'POSITIVE' | 'ATTENTION' | 'INFO';
  title: string;
  detail: string;
  evidence_foods: string[];
}

const GROUP_LABELS: Record<NutritionGroupCode, string> = {
  PROTEIN: '蛋白质来源',
  VEGETABLE: '蔬菜',
  FRUIT: '水果',
  STAPLE: '主食与碳水',
  DAIRY: '奶类',
  LEGUME: '豆类',
  HEALTHY_FAT: '坚果与健康脂肪',
  SEAFOOD: '海鲜水产',
  SEASONING: '调味品',
  OTHER: '其他',
};

const GROUP_ORDER: NutritionGroupCode[] = [
  'PROTEIN',
  'VEGETABLE',
  'FRUIT',
  'STAPLE',
  'DAIRY',
  'LEGUME',
  'HEALTHY_FAT',
  'SEAFOOD',
  'SEASONING',
  'OTHER',
];

/**
 * 将专业食材分类映射为用户可理解的营养结构分组。
 * 这是规则层，不依赖 LLM；分类不明确时保守归为 OTHER。
 */
export function nutritionGroupForCategory(categoryCode: string): NutritionGroupCode {
  const code = categoryCode.toUpperCase();
  if (['PORK', 'BEEF', 'LAMB', 'POULTRY', 'OTHER_POULTRY', 'GAME_MEAT', 'EGG'].includes(code))
    return 'PROTEIN';
  if (['FISH', 'CRAB', 'SHRIMP', 'CEPHALOPOD', 'BIVALVE'].includes(code)) return 'SEAFOOD';
  if (
    ['DAIRY', 'LIQUID_DAIRY', 'FERMENTED_DAIRY', 'CHEESE', 'MILK_PRODUCT'].includes(code)
  )
    return 'DAIRY';
  if (code === 'LEGUME' || code === 'SOY_PRODUCT' || code === 'SOY') return 'LEGUME';
  if (code === 'NUT_SEED' || code === 'TREE_NUT' || code === 'PEANUT' || code === 'OIL_FAT')
    return 'HEALTHY_FAT';
  if (
    code === 'FRUIT' ||
    code.endsWith('_FRUIT') ||
    ['BERRY', 'CITRUS', 'MELON', 'STONE'].some((part) => code.includes(part))
  )
    return 'FRUIT';
  if (
    code === 'VEGETABLE' ||
    code.endsWith('_VEGETABLE') ||
    ['ALLIUM', 'AROMATIC', 'MUSHROOM', 'FUNGI', 'SEA_VEGETABLE'].some((part) => code.includes(part))
  )
    return 'VEGETABLE';
  if (
    ['GRAIN_STAPLE', 'CORN_GRAIN', 'COARSE_GRAIN', 'TUBER_STAPLE', 'ROOT_TUBER', 'RICE'].includes(
      code,
    )
  )
    return 'STAPLE';
  if (code === 'SEASONING' || code === 'SAUCE' || code === 'SALT_SUGAR') return 'SEASONING';
  return 'OTHER';
}

function flattenInventory(items: InventoryItemView[]): InventoryItemView[] {
  return items.filter((item) => Number(item.total_quantity) > 0);
}

function buildGroups(items: InventoryItemView[]): NutritionGroupSummary[] {
  const grouped = new Map<NutritionGroupCode, InventoryItemView[]>();
  for (const item of items) {
    const group = nutritionGroupForCategory(item.category_code);
    const current = grouped.get(group) ?? [];
    current.push(item);
    grouped.set(group, current);
  }
  return GROUP_ORDER.map((code) => {
    const foods = grouped.get(code) ?? [];
    return {
      code,
      label: GROUP_LABELS[code],
      present: foods.length > 0,
      food_count: foods.length,
      foods: foods.map((item) => item.name),
    };
  });
}

export function buildNutritionObservations(
  groups: NutritionGroupSummary[],
): NutritionObservation[] {
  const has = (code: NutritionGroupCode) => groups.find((group) => group.code === code)?.present;
  const foods = (code: NutritionGroupCode) =>
    groups.find((group) => group.code === code)?.foods ?? [];
  const observations: NutritionObservation[] = [];

  const proteinFoods = [
    ...foods('PROTEIN'),
    ...foods('SEAFOOD'),
    ...foods('DAIRY'),
    ...foods('LEGUME'),
  ];
  if (proteinFoods.length > 0) {
    observations.push({
      code: 'PROTEIN_PRESENT',
      severity: 'POSITIVE',
      title: '已有蛋白质来源',
      detail: '库存中有肉、蛋或其他蛋白质食材，可以继续关注来源多样性和烹饪方式。',
      evidence_foods: [...new Set(proteinFoods)],
    });
  } else {
    observations.push({
      code: 'PROTEIN_GAP',
      severity: 'ATTENTION',
      title: '蛋白质来源偏少',
      detail: '可以考虑补充鱼、蛋、奶、豆制品或适量肉类。',
      evidence_foods: [],
    });
  }
  for (const code of ['VEGETABLE', 'FRUIT', 'STAPLE'] as const) {
    if (!has(code)) {
      observations.push({
        code: `${code}_GAP`,
        severity: 'ATTENTION',
        title: `${GROUP_LABELS[code]}暂未发现`,
        detail: `当前库存没有记录${GROUP_LABELS[code]}，建议结合家庭成员需求补充。`,
        evidence_foods: [],
      });
    }
  }
  if (has('VEGETABLE') && has('FRUIT')) {
    observations.push({
      code: 'PLANT_DIVERSITY_PRESENT',
      severity: 'POSITIVE',
      title: '已有植物性食材基础',
      detail: '库存同时包含蔬菜和水果，后续可以继续增加颜色和品种多样性。',
      evidence_foods: [...foods('VEGETABLE'), ...foods('FRUIT')],
    });
  }
  if (has('LEGUME') || has('HEALTHY_FAT')) {
    observations.push({
      code: 'DIVERSITY_SUPPORT',
      severity: 'POSITIVE',
      title: '有豆类或坚果脂肪来源',
      detail: '这为家庭饮食多样性提供了基础；具体份量仍需结合实际摄入记录判断。',
      evidence_foods: [...foods('LEGUME'), ...foods('HEALTHY_FAT')],
    });
  }
  if (!observations.length) {
    observations.push({
      code: 'INSUFFICIENT_INVENTORY',
      severity: 'INFO',
      title: '暂时没有足够库存数据',
      detail: '添加更多食材后，小知才能给出更有依据的结构分析。',
      evidence_foods: [],
    });
  }
  return observations;
}

@Injectable()
export class NutritionStructureService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(InventoryQueryService) private readonly inventory: InventoryQueryService,
  ) {}

  async householdStructure(householdId: string, userId: string) {
    const inventory = await this.inventory.getInventoryView(householdId, userId);
    const items = flattenInventory(inventory.zones.flatMap((zone) => zone.items));
    const groups = buildGroups(items);
    const foodIds = items.map((item) => item.food_id);
    const profileResult = foodIds.length
      ? await this.pool.query<{ food_id: string }>(
          `select distinct food_id from nutrition_profiles where food_id = any($1::uuid[])`,
          [foodIds],
        )
      : { rows: [] };
    const profileIds = new Set(profileResult.rows.map((row) => row.food_id));
    const profiledFoodCount = items.filter((item) => profileIds.has(item.food_id)).length;

    return {
      household_id: householdId,
      generated_at: new Date().toISOString(),
      inventory_food_count: items.length,
      groups,
      observations: buildNutritionObservations(groups),
      evidence: {
        inventory_revision: inventory.revision,
        profiled_food_count: profiledFoodCount,
        unprofiled_food_count: Math.max(items.length - profiledFoodCount, 0),
        profile_completeness: items.length
          ? Number((profiledFoodCount / items.length).toFixed(2))
          : 0,
      },
      limitations: [
        '分析基于当前在库食材，不代表任何家庭成员已经实际摄入。',
        '缺少营养资料时只做食材类别分析，不计算精确热量、疗效或减重结果。',
        '包装说明、用户确认和实际摄入记录优先于目录默认值。',
      ],
    };
  }
}
