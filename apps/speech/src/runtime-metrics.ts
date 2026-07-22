export type SpeechLatencyMetric =
  | 'client_ready_ms'
  | 'turn_to_transcript_ms'
  | 'turn_to_first_audio_ms'
  | 'upstream_ready_ms';

const MAX_SAMPLES = 240;

export interface SpeechRuntimeMetrics {
  connectionOpened(): void;
  connectionClosed(): void;
  upstreamReady(elapsedMs: number): void;
  upstreamFailed(): void;
  turnCommitted(): void;
  recordLatency(metric: SpeechLatencyMetric, elapsedMs: number): void;
  snapshot(): Record<string, unknown>;
}

function percentile(samples: number[], ratio: number): number | null {
  if (!samples.length) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1))] ?? null;
}

function summarize(samples: number[]) {
  if (!samples.length) return { count: 0, avg_ms: null, p50_ms: null, p95_ms: null };
  return {
    count: samples.length,
    avg_ms: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    p50_ms: percentile(samples, 0.5),
    p95_ms: percentile(samples, 0.95),
  };
}

/** 只保留进程级、无用户内容的性能聚合数据。容器重启后自然清零。 */
export function createSpeechRuntimeMetrics(now: () => number = Date.now): SpeechRuntimeMetrics {
  const startedAt = now();
  let activeConnections = 0;
  let connectionsTotal = 0;
  let disconnectedTotal = 0;
  let upstreamReadyTotal = 0;
  let upstreamFailedTotal = 0;
  let turnsCommittedTotal = 0;
  const samples: Record<SpeechLatencyMetric, number[]> = {
    client_ready_ms: [], turn_to_transcript_ms: [], turn_to_first_audio_ms: [], upstream_ready_ms: [],
  };
  const recordLatency = (metric: SpeechLatencyMetric, elapsedMs: number): void => {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 120_000) return;
    const values = samples[metric];
    values.push(Math.round(elapsedMs));
    if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
  };
  return {
    connectionOpened() { activeConnections += 1; connectionsTotal += 1; },
    connectionClosed() { activeConnections = Math.max(0, activeConnections - 1); disconnectedTotal += 1; },
    upstreamReady(elapsedMs) { upstreamReadyTotal += 1; recordLatency('upstream_ready_ms', elapsedMs); },
    upstreamFailed() { upstreamFailedTotal += 1; },
    turnCommitted() { turnsCommittedTotal += 1; },
    recordLatency,
    snapshot() {
      return {
        generated_at: new Date(now()).toISOString(),
        retention: 'since_process_start; latest 240 samples per latency metric; no audio or transcript content',
        uptime_seconds: Math.floor((now() - startedAt) / 1000),
        connections: { active: activeConnections, opened_total: connectionsTotal, closed_total: disconnectedTotal },
        upstream: { ready_total: upstreamReadyTotal, failed_total: upstreamFailedTotal },
        turns_committed_total: turnsCommittedTotal,
        latency_ms: Object.fromEntries((Object.keys(samples) as SpeechLatencyMetric[]).map((metric) => [metric, summarize(samples[metric])])),
      };
    },
  };
}
