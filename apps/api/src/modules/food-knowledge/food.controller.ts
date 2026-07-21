import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import { AuthGuard } from '../auth/auth.guard';

/**
 * Food Knowledge 只读 API（docs/03 §8：其他模块通过 Read API 访问）。
 * MVP 只暴露全局目录；家庭自定义食材是 P1。
 */
@Controller()
@UseGuards(AuthGuard)
export class FoodController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('foods')
  async search(@Query('q') query?: string) {
    const q = (query ?? '').trim();
    if (q.length === 0) {
      const result = await this.pool.query(
        `select fc.id, fc.canonical_name, fc.category, fc.default_unit_code,
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
      `select fc.id, fc.canonical_name, fc.category, fc.default_unit_code,
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
}
