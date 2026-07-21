import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../infra/db/database.module';
import { MembershipService } from '../household/membership.service';
import { MealPlanningService } from '../meal-planning/meal-planning.service';
import { DomainError } from '../inventory/domain/errors';

export const WellnessProfileSchema = z.object({
  birth_year: z.number().int().min(1900).max(2100).nullable().default(null),
  height_cm: z.number().min(50).max(250).nullable().default(null),
  goal: z.enum(['GENERAL_WELLNESS', 'WEIGHT_MANAGEMENT', 'MUSCLE_SUPPORT', 'BALANCED_DIET']),
  allergen_codes: z.array(z.string().min(1).max(40)).max(30).default([]),
  dietary_restrictions: z.array(z.string().min(1).max(60)).max(30).default([]),
  health_considerations: z.array(z.string().min(1).max(100)).max(30).default([]),
  share_with_household: z.boolean().default(false),
});

export const WeightEntrySchema = z.object({
  weight_kg: z.number().min(20).max(400),
  measured_at: z.string().datetime(),
  note: z.string().max(200).optional(),
});

export function buildWeightTrend(rows: Array<{ value: string; measured_at: string | Date }>) {
  const entries = rows
    .map((row) => ({ ...row, measured_at: new Date(row.measured_at).toISOString() }))
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const first = entries.at(0);
  const latest = entries.at(-1);
  return {
    entries,
    latest_kg: latest ? Number(latest.value) : null,
    change_kg:
      first && latest ? Number((Number(latest.value) - Number(first.value)).toFixed(2)) : null,
  };
}

@Injectable()
export class MemberWellnessService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(MealPlanningService) private readonly meals: MealPlanningService,
  ) {}

  private async member(householdId: string, userId: string) {
    return this.memberships.assertMembership(householdId, userId);
  }

  async getProfile(householdId: string, userId: string) {
    const member = await this.member(householdId, userId);
    return (
      (
        await this.pool.query(`select * from member_wellness_profiles where member_id=$1`, [
          member.memberId,
        ])
      ).rows[0] ?? null
    );
  }

  async upsertProfile(
    householdId: string,
    userId: string,
    input: z.infer<typeof WellnessProfileSchema>,
  ) {
    const member = await this.member(householdId, userId);
    return (
      await this.pool.query(
        `insert into member_wellness_profiles(member_id,household_id,birth_year,height_cm,goal,allergen_codes,dietary_restrictions,health_considerations,share_with_household)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict(member_id) do update set birth_year=excluded.birth_year,height_cm=excluded.height_cm,goal=excluded.goal,
       allergen_codes=excluded.allergen_codes,dietary_restrictions=excluded.dietary_restrictions,
       health_considerations=excluded.health_considerations,share_with_household=excluded.share_with_household,
       consent_updated_at=case when member_wellness_profiles.share_with_household<>excluded.share_with_household then now() else member_wellness_profiles.consent_updated_at end,updated_at=now()
       returning *`,
        [
          member.memberId,
          householdId,
          input.birth_year,
          input.height_cm,
          input.goal,
          input.allergen_codes,
          input.dietary_restrictions,
          input.health_considerations,
          input.share_with_household,
        ],
      )
    ).rows[0];
  }

  async addWeight(householdId: string, userId: string, input: z.infer<typeof WeightEntrySchema>) {
    const member = await this.member(householdId, userId);
    return (
      await this.pool.query(
        `insert into member_body_measurements(member_id,household_id,value,measured_at,note) values($1,$2,$3,$4,$5)
       returning id,value::text as value,unit_code,measured_at,note`,
        [member.memberId, householdId, input.weight_kg, input.measured_at, input.note ?? null],
      )
    ).rows[0];
  }

  async weightTrend(householdId: string, userId: string) {
    const member = await this.member(householdId, userId);
    const rows = (
      await this.pool.query<{
        id: string;
        value: string;
        measured_at: Date;
        note: string | null;
      }>(
        `select id,value::text,measured_at,note from member_body_measurements where member_id=$1 order by measured_at`,
        [member.memberId],
      )
    ).rows;
    return buildWeightTrend(rows);
  }

  async removeWeight(householdId: string, userId: string, measurementId: string) {
    const member = await this.member(householdId, userId);
    const result = await this.pool.query(
      `delete from member_body_measurements where id=$1 and member_id=$2 returning id`,
      [measurementId, member.memberId],
    );
    if (!result.rows[0])
      throw new DomainError('NOT_FOUND', 'MEASUREMENT_NOT_FOUND', '体重记录不存在。');
    return { deleted: true };
  }

  async personalizedMeals(householdId: string, userId: string) {
    const profile = await this.getProfile(householdId, userId);
    const suggestions = await this.meals.suggestions(householdId, userId);
    const allergens = new Set<string>(profile?.allergen_codes ?? []);
    const unsafe = suggestions.filter((recipe) =>
      recipe.ingredients.some((item) => item.allergen_codes.some((code) => allergens.has(code))),
    );
    const safe = suggestions.filter((recipe) => !unsafe.includes(recipe));
    return {
      goal: profile?.goal ?? 'GENERAL_WELLNESS',
      suggestions: safe,
      excluded_for_allergens: unsafe.map((recipe) => ({ id: recipe.id, name: recipe.name })),
      limitations: [
        '已录入过敏原会被强制排除。',
        '当前营养数据与个人摄入记录尚不完整，不计算精确热量、疗效或减重结果。',
        '健康情况仅用于用户自行记录，不构成诊断或医疗建议。',
      ],
    };
  }

  async deleteMyData(householdId: string, userId: string) {
    const member = await this.member(householdId, userId);
    await this.pool.query(`delete from member_wellness_profiles where member_id=$1`, [
      member.memberId,
    ]);
    return { deleted: true };
  }
}
