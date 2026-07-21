import { describe, expect, it } from 'vitest';
import { buildWeightTrend } from './member-wellness.service';

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
});
