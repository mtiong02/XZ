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
  activity_level: z.enum(['LOW', 'MODERATE', 'HIGH']).default('MODERATE'),
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

export const MeasurementMetricSchema = z.enum([
  'WEIGHT',
  'WAIST_CIRCUMFERENCE',
  'BODY_FAT_PERCENT',
  'RESTING_HEART_RATE',
  'BLOOD_PRESSURE',
]);
export type MeasurementMetric = z.infer<typeof MeasurementMetricSchema>;

const METRIC_RULES: Record<
  MeasurementMetric,
  {
    label: string;
    unitCode: string;
    unitLabel: string;
    min: number;
    max: number;
    secondary?: { min: number; max: number };
  }
> = {
  WEIGHT: { label: '体重', unitCode: 'kg', unitLabel: 'kg', min: 20, max: 400 },
  WAIST_CIRCUMFERENCE: {
    label: '腰围',
    unitCode: 'cm',
    unitLabel: 'cm',
    min: 30,
    max: 250,
  },
  BODY_FAT_PERCENT: {
    label: '体脂率',
    unitCode: 'percent',
    unitLabel: '%',
    min: 1,
    max: 75,
  },
  RESTING_HEART_RATE: {
    label: '静息心率',
    unitCode: 'bpm',
    unitLabel: '次/分',
    min: 25,
    max: 250,
  },
  BLOOD_PRESSURE: {
    label: '血压',
    unitCode: 'mmHg',
    unitLabel: 'mmHg',
    min: 40,
    max: 300,
    secondary: { min: 30, max: 200 },
  },
};

export const MeasurementEntrySchema = z
  .object({
    metric_type: MeasurementMetricSchema,
    value: z.number(),
    secondary_value: z.number().nullable().optional(),
    measured_at: z.string().datetime(),
    note: z.string().max(200).optional(),
  })
  .superRefine((input, context) => {
    const rule = METRIC_RULES[input.metric_type];
    if (input.value < rule.min || input.value > rule.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${rule.label}应在 ${rule.min}–${rule.max} ${rule.unitLabel}之间`,
      });
    }
    if (rule.secondary) {
      if (input.secondary_value == null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secondary_value'],
          message: '血压需要同时记录收缩压和舒张压',
        });
      } else if (
        input.secondary_value < rule.secondary.min ||
        input.secondary_value > rule.secondary.max ||
        input.secondary_value >= input.value
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secondary_value'],
          message: '请检查舒张压数值，并确保它低于收缩压',
        });
      }
    } else if (input.secondary_value != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondary_value'],
        message: `${rule.label}不接受第二个数值`,
      });
    }
  });

interface MeasurementRow {
  id: string;
  metric_type: string;
  value: string;
  secondary_value: string | null;
  unit_code: string;
  measured_at: string | Date;
  source: string;
  note: string | null;
}

export function buildMeasurementSummary(rows: MeasurementRow[], heightCm: number | null) {
  const sorted = rows
    .map((row) => ({
      ...row,
      value: Number(row.value),
      secondary_value: row.secondary_value == null ? null : Number(row.secondary_value),
      measured_at: new Date(row.measured_at).toISOString(),
    }))
    .sort((left, right) => left.measured_at.localeCompare(right.measured_at));

  const metrics = MeasurementMetricSchema.options.flatMap((metricType) => {
    const entries = sorted.filter((row) => row.metric_type === metricType);
    const first = entries.at(0);
    const latest = entries.at(-1);
    if (!first || !latest) return [];
    return [
      {
        metric_type: metricType,
        label: METRIC_RULES[metricType].label,
        unit: METRIC_RULES[metricType].unitLabel,
        entries,
        latest_value: latest.value,
        latest_secondary_value: latest.secondary_value,
        change: Number((latest.value - first.value).toFixed(2)),
      },
    ];
  });
  const weight = metrics.find((metric) => metric.metric_type === 'WEIGHT');
  const latestWeight = weight?.entries.at(-1);
  const bmi =
    heightCm && latestWeight
      ? {
          value: Number((latestWeight.value / (heightCm / 100) ** 2).toFixed(2)),
          measured_at: latestWeight.measured_at,
          based_on: ['PROFILE_HEIGHT', 'LATEST_WEIGHT'] as const,
        }
      : null;

  return {
    metrics,
    derived: { bmi },
    total_entries: sorted.length,
    evidence: {
      source: 'USER_RECORDED' as const,
      profile_height_available: heightCm !== null,
      measurement_count: sorted.length,
    },
    limitations: [
      '所有指标均为用户手工记录，系统不校验设备准确性。',
      'BMI 只用于身高与体重的筛查参考，不是体脂或健康诊断。',
      '单次血压或心率记录不能替代专业医疗评估。',
    ],
  };
}

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
        `insert into member_wellness_profiles(member_id,household_id,birth_year,height_cm,goal,activity_level,allergen_codes,dietary_restrictions,health_considerations,share_with_household)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict(member_id) do update set birth_year=excluded.birth_year,height_cm=excluded.height_cm,goal=excluded.goal,
       activity_level=excluded.activity_level,
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
          input.activity_level,
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
        `select id,value::text,measured_at,note from member_body_measurements where member_id=$1 and metric_type='WEIGHT' order by measured_at`,
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

  async addMeasurement(
    householdId: string,
    userId: string,
    input: z.infer<typeof MeasurementEntrySchema>,
  ) {
    const member = await this.member(householdId, userId);
    const rule = METRIC_RULES[input.metric_type];
    return (
      await this.pool.query(
        `insert into member_body_measurements
         (member_id,household_id,metric_type,value,secondary_value,unit_code,measured_at,source,note)
         values($1,$2,$3,$4,$5,$6,$7,'MANUAL',$8)
         returning id,metric_type,value::text,secondary_value::text,unit_code,measured_at,source,note`,
        [
          member.memberId,
          householdId,
          input.metric_type,
          input.value,
          input.secondary_value ?? null,
          rule.unitCode,
          input.measured_at,
          input.note ?? null,
        ],
      )
    ).rows[0];
  }

  async measurementsSummary(householdId: string, userId: string) {
    const member = await this.member(householdId, userId);
    const [profileResult, measurementResult] = await Promise.all([
      this.pool.query<{ height_cm: string | null }>(
        `select height_cm::text from member_wellness_profiles where member_id=$1`,
        [member.memberId],
      ),
      this.pool.query<MeasurementRow>(
        `select id,metric_type,value::text,secondary_value::text,unit_code,measured_at,source,note
         from member_body_measurements where member_id=$1 order by measured_at`,
        [member.memberId],
      ),
    ]);
    const rawHeight = profileResult.rows[0]?.height_cm;
    return buildMeasurementSummary(
      measurementResult.rows,
      rawHeight == null ? null : Number(rawHeight),
    );
  }

  async removeMeasurement(householdId: string, userId: string, measurementId: string) {
    const member = await this.member(householdId, userId);
    const result = await this.pool.query(
      `delete from member_body_measurements where id=$1 and member_id=$2 returning id`,
      [measurementId, member.memberId],
    );
    if (!result.rows[0])
      throw new DomainError('NOT_FOUND', 'MEASUREMENT_NOT_FOUND', '身体指标记录不存在。');
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
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from member_body_measurements where member_id=$1`, [
        member.memberId,
      ]);
      await client.query(`delete from member_wellness_profiles where member_id=$1`, [
        member.memberId,
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return { deleted: true };
  }
}
