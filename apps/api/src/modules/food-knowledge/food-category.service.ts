import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';

export interface FoodCategoryDictionaryEntry {
  code: string;
  nameZh: string;
  aliases: string[];
}

export interface ResolvedFoodCategoryQuery {
  requestedCodes: string[];
  descendantCodes: Set<string>;
  label: string;
}

export function matchFoodCategories(
  normalized: string,
  dictionary: FoodCategoryDictionaryEntry[],
): Array<{ code: string; nameZh: string }> {
  const matches: Array<{ code: string; nameZh: string; matchedLength: number; index: number }> = [];
  for (const category of dictionary) {
    const aliases = [category.nameZh, ...category.aliases]
      .filter((alias, index, values) => alias.length > 0 && values.indexOf(alias) === index)
      .sort((left, right) => right.length - left.length);
    const alias = aliases.find((candidate) => normalized.includes(candidate));
    if (!alias) continue;
    matches.push({
      code: category.code,
      nameZh: category.nameZh,
      matchedLength: alias.length,
      index: normalized.indexOf(alias),
    });
  }

  // “海鲜水产”等同义短语可能同时命中多个别名；优先保留覆盖范围更长的分类。
  matches.sort(
    (left, right) => left.index - right.index || right.matchedLength - left.matchedLength,
  );
  const kept = matches.filter(
    (match, index) =>
      !matches.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.matchedLength > match.matchedLength &&
          other.index <= match.index &&
          other.index + other.matchedLength >= match.index + match.matchedLength,
      ),
  );
  return kept.map(({ code, nameZh }) => ({ code, nameZh }));
}

@Injectable()
export class FoodCategoryService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async resolveSpokenQuery(normalized: string): Promise<ResolvedFoodCategoryQuery | null> {
    const dictionaryResult = await this.pool.query<{
      code: string;
      name_zh: string;
      aliases: string[];
    }>(
      `select c.code, c.name_zh,
              coalesce(array_agg(a.alias order by char_length(a.alias) desc)
                filter (where a.alias is not null), '{}') as aliases
       from food_categories c
       left join food_category_aliases a on a.category_code = c.code and a.locale = 'zh'
       group by c.code
       order by c.sort_order, c.code`,
    );
    const requested = matchFoodCategories(
      normalized,
      dictionaryResult.rows.map((row) => ({
        code: row.code,
        nameZh: row.name_zh,
        aliases: row.aliases,
      })),
    );
    if (requested.length === 0) return null;

    const requestedCodes = requested.map((category) => category.code);
    const descendantsResult = await this.pool.query<{ code: string }>(
      `with recursive descendants as (
         select code from food_categories where code = any($1::text[])
         union
         select child.code
         from food_categories child
         join descendants parent on child.parent_code = parent.code
       )
       select code from descendants`,
      [requestedCodes],
    );
    return {
      requestedCodes,
      descendantCodes: new Set(descendantsResult.rows.map((row) => row.code)),
      label: requested.map((category) => category.nameZh).join('和'),
    };
  }
}
