import { describe, expect, it } from 'vitest';
import { buildProductInsights } from './product-insights';

describe('buildProductInsights', () => {
  it('creates auditable recommendations from failed and ambiguous dialogue evidence', () => {
    const result = buildProductInsights([
      {
        status: 'FAILED',
        error_code: 'AMBIGUOUS_COMMAND',
        transcript_raw: '明天中午吃猪肉',
        turn_count: 5,
        dialogue_turns: [],
      },
      {
        status: 'FAILED',
        error_code: 'AMBIGUOUS_COMMAND',
        transcript_raw: '明天中午吃猪肉',
        turn_count: 4,
        dialogue_turns: [],
      },
      {
        status: 'COMPLETED',
        error_code: null,
        transcript_raw: '查看库存',
        turn_count: 1,
        dialogue_turns: [],
      },
    ]);

    expect(result.summary.headline).toContain('可执行');
    expect(result.metrics.find((metric) => metric.label === '未识别')?.value).toBe('67%');
    expect(result.insights.map((insight) => insight.id)).toEqual(
      expect.arrayContaining([
        'asr-and-semantic-normalization',
        'dialogue-state-and-confirmation',
        'task-execution-reliability',
      ]),
    );
    expect(result.insights[0]?.evidence.join(' ')).toContain('明天中午吃猪肉');
  });

  it('does not fabricate recommendations when there are no samples', () => {
    const result = buildProductInsights([]);

    expect(result.insights).toHaveLength(0);
    expect(result.summary.headline).toContain('暂无');
  });
});
