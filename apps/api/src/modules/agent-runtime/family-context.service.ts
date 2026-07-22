import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import type { FamilyMealContext } from './agent-runtime.types';

export interface FamilyMealProfileUpdate {
  homeMode?: FamilyMealContext['homeMode'] | undefined;
  defaultDiners?: number | undefined;
  favoriteFoods?: string[] | undefined;
  excludedFoods?: string[] | undefined;
  mealStyles?: string[] | undefined;
}

/**
 * 家庭餐食模型的唯一读取入口。它把成员限制、家庭偏好和在家模式
 * 组合成规划器需要的上下文，但不拥有任何写入能力。
 */
@Injectable()
export class FamilyContextService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async build(householdId: string, memberId: string): Promise<FamilyMealContext> {
    const [profileResult, householdResult] = await Promise.all([
      this.pool.query<{
        member_id: string;
        display_name: string;
        goal: string | null;
        allergen_codes: string[] | null;
        dietary_restrictions: string[] | null;
        health_considerations: string[] | null;
      }>(
        `select hm.id as member_id, hm.display_name, p.goal, p.allergen_codes,
                p.dietary_restrictions, p.health_considerations
           from household_members hm
           left join member_wellness_profiles p on p.member_id=hm.id
          where hm.household_id=$1
          order by case when hm.id=$2 then 0 else 1 end, hm.created_at`,
        [householdId, memberId],
      ),
      this.pool
        .query<{
          home_mode: FamilyMealContext['homeMode'];
          default_diners: number | null;
          favorite_foods: string[] | null;
          excluded_foods: string[] | null;
          meal_styles: string[] | null;
        }>(
          `select home_mode, default_diners, favorite_foods, excluded_foods, meal_styles
             from household_meal_profiles where household_id=$1`,
          [householdId],
        )
        .catch(() => ({ rows: [] })),
    ]);

    const row = householdResult.rows[0];
    const members = profileResult.rows.map((profile) => ({
      memberId: profile.member_id,
      displayName: profile.display_name,
      goal: profile.goal,
      allergens: profile.allergen_codes ?? [],
      restrictions: profile.dietary_restrictions ?? [],
      healthConsiderations: profile.health_considerations ?? [],
    }));

    const memberCount = Math.max(1, members.length);
    return {
      homeMode: row?.home_mode ?? 'UNKNOWN',
      defaultDiners: Math.max(1, Number(row?.default_diners ?? memberCount)),
      memberCount,
      members,
      householdPreferences: {
        favoriteFoods: row?.favorite_foods ?? [],
        excludedFoods: row?.excluded_foods ?? [],
        mealStyles: row?.meal_styles ?? [],
      },
    };
  }

  async upsert(householdId: string, input: FamilyMealProfileUpdate) {
    const result = await this.pool.query(
      `insert into household_meal_profiles
        (household_id, home_mode, default_diners, favorite_foods, excluded_foods, meal_styles)
       values ($1, coalesce($2,'FULL_HOUSEHOLD'), coalesce($3,1), coalesce($4,'{}'), coalesce($5,'{}'), coalesce($6,'{}'))
       on conflict (household_id) do update set
         home_mode=coalesce($2, household_meal_profiles.home_mode),
         default_diners=coalesce($3, household_meal_profiles.default_diners),
         favorite_foods=coalesce($4, household_meal_profiles.favorite_foods),
         excluded_foods=coalesce($5, household_meal_profiles.excluded_foods),
         meal_styles=coalesce($6, household_meal_profiles.meal_styles),
         updated_at=now()
       returning household_id, home_mode, default_diners, favorite_foods, excluded_foods, meal_styles, updated_at`,
      [
        householdId,
        input.homeMode ?? null,
        input.defaultDiners ?? null,
        input.favoriteFoods ?? null,
        input.excludedFoods ?? null,
        input.mealStyles ?? null,
      ],
    );
    return result.rows[0];
  }
}
