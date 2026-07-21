import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { DomainError } from '../inventory/domain/errors';

export const CreateHouseholdFoodSchema = z.object({
  canonical_name: z.string().trim().min(1).max(100),
  category_code: z.string().trim().min(2).max(50),
  default_unit_code: z.string().trim().min(1).max(30),
  preferred_unit_codes: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  default_shelf_life_days: z.number().int().positive().max(3650).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const CreateFoodAliasSchema = z.object({ alias: z.string().trim().min(1).max(100) });

type FoodRow = {
  id: string; canonical_name: string; category: string; category_code: string;
  default_unit_code: string; preferred_unit_codes: string[]; default_shelf_life_days: number | null;
};

export function normalizeFoodAliases(canonicalName: string, aliases: string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== canonicalName))];
}

@Injectable()
export class FoodKnowledgeService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly memberships: MembershipService,
  ) {}

  async listHouseholdFoods(householdId: string, userId: string, query?: string) {
    await this.memberships.assertMembership(householdId, userId);
    const q = (query ?? '').trim();
    const result = await this.pool.query(
      `with recursive category_paths as (
         select code, parent_code, array[name_zh] as name_path
         from food_categories where parent_code is null
         union all
         select child.code, child.parent_code, parent.name_path || child.name_zh
         from food_categories child join category_paths parent on child.parent_code = parent.code
       )
       select fc.id, fc.canonical_name, fc.category, fc.category_code, cp.name_path as category_path,
              fc.default_unit_code,
              fc.preferred_unit_codes, fc.default_shelf_life_days,
              fc.data_source, fc.source_reference, fc.allergen_codes, fc.review_status,
              (fc.household_id is not null) as is_custom,
              coalesce(array_agg(fa.alias order by fa.alias) filter (where fa.alias is not null), '{}') as aliases
       from food_catalog fc
       join category_paths cp on cp.code = fc.category_code
       left join food_aliases fa on fa.food_id = fc.id
       where (fc.household_id is null or fc.household_id = $1)
         and ($2 = '' or fc.canonical_name ilike '%' || $2 || '%'
              or exists (select 1 from food_aliases a where a.food_id = fc.id and a.alias ilike '%' || $2 || '%'))
       group by fc.id, cp.name_path
       order by cp.name_path, fc.canonical_name limit 200`,
      [householdId, q],
    );
    return result.rows;
  }

  async createHouseholdFood(householdId: string, userId: string, input: z.infer<typeof CreateHouseholdFoodSchema>) {
    await this.memberships.assertMembership(householdId, userId);
    const aliases = normalizeFoodAliases(input.canonical_name, input.aliases);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.assertLeafCategory(client, input.category_code);
      await this.assertUnits(client, [input.default_unit_code, ...input.preferred_unit_codes]);
      const duplicate = await client.query<{ id: string }>(
        `select id from food_catalog where canonical_name = $1 and (household_id is null or household_id = $2) limit 1`,
        [input.canonical_name, householdId],
      );
      if (duplicate.rowCount) throw new DomainError('VALIDATION', 'FOOD_NAME_CONFLICT', '该食材已在目录中，请直接使用或换一个名称。');
      const created = await client.query<FoodRow>(
        `insert into food_catalog (household_id, canonical_name, category, category_code, default_unit_code, preferred_unit_codes, default_shelf_life_days, data_source, review_status)
         values ($1, $2, 'OTHER', $3, $4, $5, $6, 'HOUSEHOLD', 'HOUSEHOLD') returning id, canonical_name, category, category_code, default_unit_code, preferred_unit_codes, default_shelf_life_days`,
        [householdId, input.canonical_name, input.category_code, input.default_unit_code, [...new Set(input.preferred_unit_codes)], input.default_shelf_life_days ?? null],
      );
      const food = created.rows[0];
      if (!food) throw new Error('Food creation did not return a row.');
      for (const alias of aliases) await client.query(`insert into food_aliases (food_id, alias) values ($1, $2)`, [food.id, alias]);
      await client.query('commit');
      return { ...food, aliases, is_custom: true };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async addAlias(householdId: string, userId: string, foodId: string, alias: string) {
    await this.memberships.assertMembership(householdId, userId);
    const result = await this.pool.query(
      `insert into food_aliases (food_id, alias)
       select id, $3 from food_catalog where id = $1 and household_id = $2
       on conflict (food_id, alias) do nothing returning alias`, [foodId, householdId, alias.trim()],
    );
    if (!result.rowCount) {
      const exists = await this.pool.query(`select 1 from food_catalog where id = $1 and household_id = $2`, [foodId, householdId]);
      if (!exists.rowCount) throw new DomainError('NOT_FOUND', 'CUSTOM_FOOD_NOT_FOUND', '未找到可编辑的家庭自定义食材。');
    }
    return { alias: alias.trim() };
  }

  private async assertLeafCategory(client: PoolClient, categoryCode: string) {
    const result = await client.query<{ is_leaf: boolean }>(
      `select not exists (select 1 from food_categories child where child.parent_code = c.code) as is_leaf
       from food_categories c where c.code = $1`, [categoryCode],
    );
    if (!result.rows[0]?.is_leaf) throw new DomainError('VALIDATION', 'FOOD_CATEGORY_MUST_BE_LEAF', '请选择最具体的食材分类。');
  }

  private async assertUnits(client: PoolClient, codes: string[]) {
    const uniqueCodes = [...new Set(codes)];
    const result = await client.query<{ code: string }>(`select code from units where code = any($1::text[])`, [uniqueCodes]);
    if (result.rows.length !== uniqueCodes.length) throw new DomainError('VALIDATION', 'UNKNOWN_UNIT', '存在不支持的计量单位。');
  }
}
