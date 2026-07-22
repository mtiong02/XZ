import { describe, expect, it } from 'vitest';
import { createSpeechRuntimeMetrics } from './runtime-metrics';

describe('speech runtime metrics', () => {
  it('aggregates latency without retaining a transcript or audio payload', () => {
    let clock = 1_000;
    const metrics = createSpeechRuntimeMetrics(() => clock);
    metrics.connectionOpened();
    metrics.turnCommitted();
    metrics.recordLatency('turn_to_first_audio_ms', 220);
    metrics.recordLatency('turn_to_first_audio_ms', 420);
    metrics.connectionClosed();
    clock += 2_000;
    expect(metrics.snapshot()).toMatchObject({
      uptime_seconds: 2,
      connections: { active: 0, opened_total: 1, closed_total: 1 },
      turns_committed_total: 1,
      latency_ms: { turn_to_first_audio_ms: { count: 2, avg_ms: 320, p50_ms: 220, p95_ms: 420 } },
    });
  });

  it('rejects impossible measurements', () => {
    const metrics = createSpeechRuntimeMetrics();
    metrics.recordLatency('client_ready_ms', -1);
    metrics.recordLatency('client_ready_ms', 120_001);
    expect(metrics.snapshot()).toMatchObject({ latency_ms: { client_ready_ms: { count: 0 } } });
  });
});
