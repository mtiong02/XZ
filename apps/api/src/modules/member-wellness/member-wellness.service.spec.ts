import { describe, expect, it } from 'vitest';
import {
  buildMeasurementSummary,
  buildWeightTrend,
  MeasurementEntrySchema,
} from './member-wellness.service';

describe('member wellness helpers', () => {
  it('orders entries and calculates change', () => {
    expect(
      buildWeightTrend([
        { value: '69.20', measured_at: '2026-07-21T00:00:00.000Z' },
        { value: '70.00', measured_at: '2026-07-01T00:00:00.000Z' },
      ]),
    ).toMatchObject({ latest_kg: 69.2, change_kg: -0.8 });
  });

  it('returns nulls without entries', () => {
    expect(buildWeightTrend([])).toMatchObject({ latest_kg: null, change_kg: null });
  });

  it('validates metric-specific value pairs', () => {
    expect(
      MeasurementEntrySchema.parse({
        metric_type: 'BLOOD_PRESSURE',
        value: 118,
        secondary_value: 76,
        measured_at: '2026-07-22T01:00:00.000Z',
      }),
    ).toMatchObject({ metric_type: 'BLOOD_PRESSURE', value: 118, secondary_value: 76 });

    expect(() =>
      MeasurementEntrySchema.parse({
        metric_type: 'BLOOD_PRESSURE',
        value: 118,
        measured_at: '2026-07-22T01:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      MeasurementEntrySchema.parse({
        metric_type: 'WAIST_CIRCUMFERENCE',
        value: 500,
        measured_at: '2026-07-22T01:00:00.000Z',
      }),
    ).toThrow();
  });

  it('groups measurement trends and derives BMI from recorded height and latest weight', () => {
    expect(
      buildMeasurementSummary(
        [
          {
            id: 'weight-old',
            metric_type: 'WEIGHT',
            value: '72.00',
            secondary_value: null,
            unit_code: 'kg',
            measured_at: '2026-07-01T00:00:00.000Z',
            source: 'MANUAL',
            note: null,
          },
          {
            id: 'weight-new',
            metric_type: 'WEIGHT',
            value: '70.00',
            secondary_value: null,
            unit_code: 'kg',
            measured_at: '2026-07-22T00:00:00.000Z',
            source: 'MANUAL',
            note: null,
          },
          {
            id: 'waist',
            metric_type: 'WAIST_CIRCUMFERENCE',
            value: '82.50',
            secondary_value: null,
            unit_code: 'cm',
            measured_at: '2026-07-22T00:00:00.000Z',
            source: 'MANUAL',
            note: null,
          },
        ],
        175,
      ),
    ).toMatchObject({
      total_entries: 3,
      derived: { bmi: { value: 22.86, measured_at: '2026-07-22T00:00:00.000Z' } },
      metrics: [
        { metric_type: 'WEIGHT', latest_value: 70, change: -2 },
        { metric_type: 'WAIST_CIRCUMFERENCE', latest_value: 82.5, change: 0 },
      ],
    });
  });
});
