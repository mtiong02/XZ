import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateFoodAliasSchema, CreateHouseholdFoodSchema, FoodKnowledgeService } from './food-knowledge.service';

/**
 * Food Knowledge 只读 API（docs/03 §8：其他模块通过 Read API 访问）。
 * 全局目录和家庭自定义食材均由 Food Knowledge 模块拥有。
 */
@Controller()
@UseGuards(AuthGuard)
export class FoodController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FoodKnowledgeService) private readonly foods: FoodKnowledgeService,
  ) {}

  @Get('households/:householdId/foods')
  async listHouseholdFoods(@CurrentUser() user: AuthenticatedUser, @Param('householdId', ParseUUIDPipe) householdId: string, @Query('q') query?: string) {
    return this.foods.listHouseholdFoods(householdId, user.userId, query);
  }

  @Post('households/:householdId/foods')
  async createHouseholdFood(@CurrentUser() user: AuthenticatedUser, @Param('householdId', ParseUUIDPipe) householdId: string, @Body() body: unknown) {
    return this.foods.createHouseholdFood(householdId, user.userId, CreateHouseholdFoodSchema.parse(body));
  }

  @Post('households/:householdId/foods/:foodId/aliases')
  async addAlias(@CurrentUser() user: AuthenticatedUser, @Param('householdId', ParseUUIDPipe) householdId: string, @Param('foodId', ParseUUIDPipe) foodId: string, @Body() body: unknown) {
    return this.foods.addAlias(householdId, user.userId, foodId, CreateFoodAliasSchema.parse(body).alias);
  }

  @Get('foods')
  async search(@Query('q') query?: string) {
    const q = (query ?? '').trim();
    if (q.length === 0) {
      const result = await this.pool.query(
        `select fc.id, fc.canonical_name, fc.category, fc.category_code, fc.default_unit_code,
                fc.preferred_unit_codes,
                fc.default_shelf_life_days,
                coalesce(array_agg(fa.alias) filter (where fa.alias is not null), '{}') as aliases
         from food_catalog fc
         left join food_aliases fa on fa.food_id = fc.id
         where fc.household_id is null
         group by fc.id
         order by fc.canonical_name
         limit 100`,
      );
      return result.rows;
    }
    const result = await this.pool.query(
      `select fc.id, fc.canonical_name, fc.category, fc.category_code, fc.default_unit_code,
              fc.preferred_unit_codes,
              fc.default_shelf_life_days,
              coalesce(array_agg(fa.alias) filter (where fa.alias is not null), '{}') as aliases
       from food_catalog fc
       left join food_aliases fa on fa.food_id = fc.id
       where fc.household_id is null
         and (fc.canonical_name ilike '%' || $1 || '%'
              or exists (select 1 from food_aliases a
                         where a.food_id = fc.id and a.alias ilike '%' || $1 || '%'))
       group by fc.id
       order by fc.canonical_name
       limit 50`,
      [q],
    );
    return result.rows;
  }

  @Get('units')
  async listUnits() {
    const result = await this.pool.query(
      `select code, name_zh, name_en, kind, base_factor from units order by kind, code`,
    );
    return result.rows;
  }

  @Get('food-categories')
  async listCategories() {
    const result = await this.pool.query(
      `with recursive category_tree as (
         select code, parent_code, name_zh, name_en, sort_order, 0 as depth,
                array[code] as code_path, array[name_zh] as name_path
         from food_categories
         where parent_code is null
         union all
         select child.code, child.parent_code, child.name_zh, child.name_en,
                child.sort_order, parent.depth + 1,
                parent.code_path || child.code, parent.name_path || child.name_zh
         from food_categories child
         join category_tree parent on child.parent_code = parent.code
       )
       select tree.code, tree.parent_code, tree.name_zh, tree.name_en, tree.depth,
              tree.code_path, tree.name_path,
              coalesce(array_agg(alias.alias order by alias.alias)
                filter (where alias.alias is not null), '{}') as aliases
       from category_tree tree
       left join food_category_aliases alias on alias.category_code = tree.code
       group by tree.code, tree.parent_code, tree.name_zh, tree.name_en, tree.depth,
                tree.code_path, tree.name_path, tree.sort_order
       order by tree.code_path`,
    );
    return result.rows;
  }
}
