import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { InventoryCommandService } from '../inventory/application/inventory-command.service';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';
import { DomainError } from '../inventory/domain/errors';
import {
  buildMealContextRecommendation,
  parseMealContext,
} from '../interaction/dialogue/meal-recommendations';
import { PersonalizedMealAgentService } from './personalized-meal-agent.service';
import { ContextBuilder, type MealDecisionContext } from '../agent-runtime/context-builder';
import { AgentToolExecutor } from '../agent-runtime/agent-tool-executor';
import { FamilyContextService } from '../agent-runtime/family-context.service';

export const AddShoppingItemSchema = z.object({
  food_id: z.string().uuid(),
  quantity: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .optional(),
  unit_code: z.string().min(1).max(30).optional(),
  source: z.enum(['MANUAL', 'RECIPE', 'VOICE']).default('MANUAL'),
  recipe_id: z.string().uuid().optional(),
  idempotency_key: z.string().min(8).max(100),
});

export const ShoppingItemStatusSchema = z.object({
  status: z.enum(['PURCHASED', 'CANCELLED']),
});

export const PersonalizedMealRequestSchema = z.object({
  request_text: z.string().trim().min(2).max(300),
});

export interface MealSuggestion {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  tags: string[];
  servings: number;
  ingredients: Array<{
    food_id: string;
    food_name: string;
    quantity: string | null;
    unit_code: string | null;
    optional: boolean;
    allergen_codes: string[];
    available: boolean;
    inventory_quantity: string | null;
    inventory_unit: string | null;
    expiry_status: string | null;
  }>;
  coverage: number;
  can_make: boolean;
  missing: Array<{
    food_id: string;
    food_name: string;
    quantity: string | null;
    unit_code: string | null;
    optional: boolean;
    allergen_codes: string[];
    available: boolean;
    inventory_quantity: string | null;
    inventory_unit: string | null;
    expiry_status: string | null;
  }>;
  expiring_ingredient_count: number;
}

@Injectable()
export class MealPlanningService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(InventoryQueryService) private readonly inventory: InventoryQueryService,
    @Inject(PersonalizedMealAgentService) private readonly mealAgent: PersonalizedMealAgentService,
    @Optional() @Inject(ContextBuilder) private readonly contextBuilder?: ContextBuilder,
    @Optional() @Inject(FamilyContextService) private readonly familyContext?: FamilyContextService,
    @Optional() @Inject(AgentToolExecutor) private readonly toolExecutor?: AgentToolExecutor,
    @Optional()
    @Inject(InventoryCommandService)
    private readonly inventoryCommands?: InventoryCommandService,
  ) {}

  async suggestions(householdId: string, userId: string): Promise<MealSuggestion[]> {
    const inventory = await this.inventory.getInventoryView(householdId, userId);
    const stocked = new Map(
      inventory.zones.flatMap((zone) => zone.items).map((item) => [item.food_id, item]),
    );
    const recipes = await this.pool.query<{
      id: string;
      name: string;
      description: string;
      instructions: string[];
      tags: string[];
      servings: number;
      ingredients: Array<{
        food_id: string;
        food_name: string;
        quantity: string | null;
        unit_code: string | null;
        optional: boolean;
        allergen_codes: string[];
      }>;
    }>(
      `select r.id,r.name,r.description,r.instructions,r.tags,r.servings,
       jsonb_agg(jsonb_build_object('food_id',fc.id,'food_name',fc.canonical_name,
         'quantity',ri.quantity::text,'unit_code',ri.unit_code,'optional',ri.optional,
         'allergen_codes',fc.allergen_codes)
         order by fc.canonical_name) as ingredients
       from recipes r join recipe_ingredients ri on ri.recipe_id=r.id
       join food_catalog fc on fc.id=ri.food_id group by r.id order by r.name`,
    );
    const mapped = recipes.rows.map((recipe) => {
      const ingredients = recipe.ingredients.map((ingredient) => {
        const item = stocked.get(ingredient.food_id);
        const enough =
          item && ingredient.quantity && ingredient.unit_code === item.unit
            ? Number(item.total_quantity) >= Number(ingredient.quantity)
            : Boolean(item);
        return {
          ...ingredient,
          available: Boolean(enough),
          inventory_quantity: item?.total_quantity ?? null,
          inventory_unit: item?.unit ?? null,
          expiry_status: item?.expiry_status ?? null,
        };
      });
      const required = ingredients.filter((item) => !item.optional);
      const availableCount = required.filter((item) => item.available).length;
      const expiringCount = ingredients.filter(
        (item) => item.expiry_status === 'EXPIRING' || item.expiry_status === 'EXPIRED',
      ).length;
      return {
        ...recipe,
        ingredients,
        coverage: required.length ? availableCount / required.length : 0,
        can_make: availableCount === required.length,
        missing: required.filter((item) => !item.available),
        expiring_ingredient_count: expiringCount,
      };
    });

    // 食材指纹去重：防止“牛肉炖土豆”与“土豆炖牛腩”等同质化菜谱同时冗余推送
    const seenKeys = new Set<string>();
    const deduplicated = mapped.filter((recipe) => {
      const ingredientFingerprint = recipe.ingredients
        .filter((item) => !item.optional)
        .map((item) => item.food_id)
        .sort()
        .join(':');
      if (!ingredientFingerprint) return true;
      if (seenKeys.has(ingredientFingerprint)) return false;
      seenKeys.add(ingredientFingerprint);
      return true;
    });

    return deduplicated.sort(
      (left, right) =>
        Number(right.can_make) - Number(left.can_make) ||
        right.expiring_ingredient_count - left.expiring_ingredient_count ||
        right.coverage - left.coverage ||
        left.missing.length - right.missing.length ||
        left.name.localeCompare(right.name, 'zh-CN'),
    );
  }

  /** 将用户口语菜名映射到已审核菜谱；只用于只读的“缺什么”问答，不会自动写购物清单。 */
  async findSuggestedRecipeForVoiceRequest(
    householdId: string,
    userId: string,
    normalizedText: string,
  ): Promise<MealSuggestion | null> {
    const canonicalName = /土豆.*(?:牛腩|牛肉)|(?:牛腩|牛肉).*土豆/.test(normalizedText)
      ? '土豆炖牛腩'
      : null;
    if (!canonicalName) return null;
    return (
      (await this.suggestions(householdId, userId)).find(
        (recipe) => recipe.name === canonicalName,
      ) ?? null
    );
  }

  /**
   * 语音餐食推荐的应用服务：库存与菜谱是事实来源；场景理解只改变候选排序与表达，绝不写库存。
   * 家庭/聚会未明确人数时，使用家庭成员记录作为份量提示，仍提醒用户在制作前复核备料。
   */
  async buildVoiceMealRecommendation(
    householdId: string,
    userId: string,
    text: string,
    inventoryItems: ReadonlyArray<{
      name: string;
      total_quantity?: string;
      unit?: string;
      expiry_status?: string;
    }>,
    options: { taskId?: string | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<string> {
    const member = await this.memberships.assertMembership(householdId, userId);
    const [recipes, memberCount, familyContext] = await Promise.all([
      this.suggestions(householdId, userId),
      this.pool.query<{ count: string }>(
        `select count(*)::text as count from household_members where household_id=$1`,
        [householdId],
      ),
      this.familyContext?.build(householdId, member.memberId) ?? Promise.resolve(null),
    ]);
    const householdMemberCount = Math.max(1, Number(memberCount.rows[0]?.count ?? 1));
    const context =
      this.contextBuilder?.build({
        requestText: text,
        inventory: inventoryItems,
        householdMemberCount,
        familyContext: familyContext ?? undefined,
      }) ?? parseMealContext(text);
    const fallbackAnswer = buildMealContextRecommendation(
      context,
      inventoryItems,
      recipes,
      householdMemberCount,
    );
    const run = () =>
      this.mealAgent.recommend({
        householdId,
        memberId: member.memberId,
        requestText: text,
        inventory: inventoryItems.map((item) => ({
          name: item.name,
          ...(item.total_quantity ? { quantity: item.total_quantity } : {}),
          ...(item.unit ? { unit: item.unit } : {}),
          ...(item.expiry_status ? { expiryStatus: item.expiry_status } : {}),
        })),
        recipes: recipes.slice(0, 10).map((recipe) => ({
          name: recipe.name,
          description: recipe.description,
          servings: recipe.servings,
          canMake: recipe.can_make,
          coverage: recipe.coverage,
          ingredients: recipe.ingredients.map((item) => item.food_name),
          missing: recipe.missing.map((item) => item.food_name),
          expiringIngredientCount: recipe.expiring_ingredient_count,
        })),
        householdMemberCount,
        familyContext: familyContext ?? undefined,
        temporaryContext:
          'temporaryContext' in context
            ? (context as MealDecisionContext).temporaryContext
            : undefined,
        fallbackAnswer,
        signal: options.signal,
      });
    if (!this.toolExecutor || !options.taskId) return run();
    return this.toolExecutor.execute(
      'meal.recommend',
      {
        taskId: options.taskId,
        signal: options.signal,
      },
      run,
    );
  }

  /**
   * 家庭人数只是默认事实，不是当前任务事实。当前请求没有说明人数/模式时，
   * 只追问一次；用户的回答由同一会话合并到本次任务，不写回家庭配置。
   */
  async getMealContextClarification(householdId: string, userId: string, text: string) {
    const parsed = parseMealContext(text);
    const hasDiners = parsed.dinerCount !== null || parsed.diningMode !== 'UNSPECIFIED';
    const hasPreference =
      /清淡|少油|少盐|低脂|减脂|减肥|辣|不辣|口味|忌口|过敏|不吃|喜欢|偏好/.test(text);
    if (hasDiners && hasPreference) return null;

    const missing: string[] = [];
    if (!hasDiners) missing.push('今天几个人吃');
    if (!hasPreference) missing.push('想清淡、少油，还是有忌口');
    return `我先结合你家的库存来分析。为了推荐得更合适，请告诉我${missing.join('，以及')}。`;
  }

  /** 手动页面与语音复用同一套按需 Agent；调用只生成建议，不产生库存副作用。 */
  async personalizedRecommendation(householdId: string, userId: string, requestText: string) {
    const inventory = await this.inventory.getInventoryView(householdId, userId);
    const items = inventory.zones.flatMap((zone) => zone.items);
    return {
      text: await this.buildVoiceMealRecommendation(householdId, userId, requestText, items),
    };
  }

  async addMissingFromRecipe(householdId: string, recipeId: string, userId: string) {
    const suggestions = await this.suggestions(householdId, userId);
    const recipe = suggestions.find((item) => item.id === recipeId);
    if (!recipe) throw new DomainError('NOT_FOUND', 'RECIPE_NOT_FOUND', '菜谱不存在。');
    const results = [];
    for (const ingredient of recipe.missing) {
      results.push(
        await this.addShoppingItem(householdId, userId, {
          food_id: ingredient.food_id,
          ...(ingredient.quantity ? { quantity: ingredient.quantity } : {}),
          ...(ingredient.unit_code ? { unit_code: ingredient.unit_code } : {}),
          source: 'RECIPE',
          recipe_id: recipeId,
          idempotency_key: `recipe-${recipeId}-${ingredient.food_id}`,
        }),
      );
    }
    return { recipe_id: recipeId, added_count: results.length, items: results };
  }

  async listShoppingItems(householdId: string, userId: string) {
    await this.memberships.assertMembership(householdId, userId);
    return (
      await this.pool.query(
        `select sli.id,sli.food_id,fc.canonical_name as food_name,sli.quantity::text,
         sli.unit_code,sli.status,sli.source,sli.recipe_id,r.name as recipe_name,sli.created_at
         from shopping_list_items sli join food_catalog fc on fc.id=sli.food_id
         left join recipes r on r.id=sli.recipe_id
         where sli.household_id=$1 and sli.status='PENDING' order by sli.created_at desc`,
        [householdId],
      )
    ).rows;
  }

  async addShoppingItem(
    householdId: string,
    userId: string,
    input: z.infer<typeof AddShoppingItemSchema>,
  ) {
    const member = await this.memberships.assertMembership(householdId, userId);
    if (Boolean(input.quantity) !== Boolean(input.unit_code)) {
      throw new DomainError(
        'VALIDATION',
        'SHOPPING_QUANTITY_UNIT_REQUIRED',
        '数量和单位需要一起提供。',
      );
    }
    const result = await this.pool.query(
      `insert into shopping_list_items
       (household_id,food_id,quantity,unit_code,source,recipe_id,idempotency_key,created_by_member_id)
       select $1,fc.id,$3,$4,$5,$6,$7,$8 from food_catalog fc
       where fc.id=$2 and (fc.household_id is null or fc.household_id=$1)
       on conflict(household_id,idempotency_key) do update set
       quantity=excluded.quantity,unit_code=excluded.unit_code,status='PENDING',
       source=excluded.source,recipe_id=excluded.recipe_id,
       created_by_member_id=excluded.created_by_member_id,created_at=now(),completed_at=null
       returning id,food_id,quantity::text,unit_code,status,source,recipe_id`,
      [
        householdId,
        input.food_id,
        input.quantity ?? null,
        input.unit_code ?? null,
        input.source,
        input.recipe_id ?? null,
        input.idempotency_key,
        member.memberId,
      ],
    );
    if (!result.rows[0]) throw new DomainError('NOT_FOUND', 'FOOD_NOT_FOUND', '食材不存在。');
    return result.rows[0];
  }

  async updateShoppingItemStatus(
    householdId: string,
    itemId: string,
    userId: string,
    status: 'PURCHASED' | 'CANCELLED',
  ) {
    await this.memberships.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `update shopping_list_items set status=$3,completed_at=now()
       where id=$1 and household_id=$2 and status='PENDING'
       returning id,status,completed_at`,
      [itemId, householdId, status],
    );
    if (!result.rows[0])
      throw new DomainError('NOT_FOUND', 'SHOPPING_ITEM_NOT_FOUND', '购物清单项目不存在。');
    return result.rows[0];
  }

  /**
   * 将“已购买”作为一个完整业务动作处理：购买的数量先通过库存命令边界入库，
   * 再完成待购项状态更新。幂等键绑定待购项，网络重试不会重复增加库存。
   */
  async markShoppingItemPurchased(householdId: string, itemId: string, userId: string) {
    const member = await this.memberships.assertMembership(householdId, userId);
    const itemResult = await this.pool.query<{
      id: string;
      food_id: string;
      food_name: string;
      quantity: string | null;
      unit_code: string | null;
      status: 'PENDING' | 'PURCHASED' | 'CANCELLED';
    }>(
      `select sli.id,sli.food_id,fc.canonical_name as food_name,sli.quantity::text,
       sli.unit_code,sli.status
       from shopping_list_items sli
       join food_catalog fc on fc.id=sli.food_id
       where sli.id=$1 and sli.household_id=$2`,
      [itemId, householdId],
    );
    const item = itemResult.rows[0];
    if (!item) {
      throw new DomainError('NOT_FOUND', 'SHOPPING_ITEM_NOT_FOUND', '购物清单项目不存在。');
    }
    if (item.status === 'PURCHASED') {
      return {
        shopping_item_id: item.id,
        status: item.status,
        inventory_transaction_id: null,
        idempotent_replay: true,
      };
    }
    if (item.status !== 'PENDING') {
      throw new DomainError(
        'CONFLICT',
        'SHOPPING_ITEM_NOT_PENDING',
        '该待购项已被移除，无法标记为已购买。',
      );
    }
    if (!item.quantity || !item.unit_code) {
      throw new DomainError(
        'VALIDATION',
        'SHOPPING_QUANTITY_UNIT_REQUIRED',
        `“${item.food_name}”缺少数量或单位，请先补充后再标记为已购买。`,
      );
    }
    if (!this.inventoryCommands) {
      throw new Error('Inventory command service is not available');
    }

    const command = await this.inventoryCommands.execute(
      {
        command_type: 'ADD_INVENTORY',
        schema_version: '1.0',
        household_id: householdId,
        source: {
          channel: 'WEB_MANUAL',
          client: 'meal-shopping-list',
          interaction_id: `shopping:${item.id}`,
        },
        idempotency_key: `shopping-purchase-${item.id}`,
        payload: {
          items: [
            {
              food_id: item.food_id,
              quantity: item.quantity,
              unit: item.unit_code,
            },
          ],
        },
      },
      userId,
    );

    const updated = await this.pool.query<{ id: string; status: string; completed_at: string }>(
      `update shopping_list_items set status='PURCHASED',completed_at=now()
       where id=$1 and household_id=$2 and status='PENDING'
       returning id,status,completed_at`,
      [item.id, householdId],
    );
    if (!updated.rows[0]) {
      // 库存命令已经用幂等键成功，下一次请求会重放而不会重复入库。
      throw new DomainError(
        'CONFLICT',
        'SHOPPING_ITEM_STATE_CHANGED',
        '待购项状态已发生变化，请刷新后重试。',
      );
    }
    return {
      shopping_item_id: updated.rows[0].id,
      status: updated.rows[0].status,
      inventory_transaction_id: command.transaction_id,
      idempotent_replay: command.idempotent_replay,
      member_id: member.memberId,
    };
  }
}
