import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { InventoryQueryService } from '../inventory/application/inventory-query.service';
import { DomainError } from '../inventory/domain/errors';

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

@Injectable()
export class MealPlanningService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(InventoryQueryService) private readonly inventory: InventoryQueryService,
  ) {}

  async suggestions(householdId: string, userId: string) {
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
    return recipes.rows
      .map((recipe) => {
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
      })
      .sort(
        (left, right) =>
          Number(right.can_make) - Number(left.can_make) ||
          right.expiring_ingredient_count - left.expiring_ingredient_count ||
          right.coverage - left.coverage,
      );
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
}
