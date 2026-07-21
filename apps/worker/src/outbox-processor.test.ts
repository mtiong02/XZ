import { describe, expect, it, vi } from 'vitest';
import { OutboxProcessor } from './outbox-processor';
import type { Broadcaster, BroadcastMessage } from './realtime-broadcaster';

/**
 * 用可编程的 fake Pool/Client 验证 outbox 消费的关键不变量，
 * 不依赖真实数据库（真实约束在 Sprint 4 集成冒烟中覆盖）。
 */

interface QueryCall {
  text: string;
  values: unknown[];
}

function makeClient(claimRows: unknown[]) {
  const calls: QueryCall[] = [];
  const client = {
    calls,
    query: vi.fn((text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (text.includes('from outbox_events') && text.includes('for update skip locked')) {
        return Promise.resolve({ rows: claimRows });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  return client;
}

function makePool(client: ReturnType<typeof makeClient>) {
  return { connect: vi.fn(() => Promise.resolve(client)) } as never;
}

class OkBroadcaster implements Broadcaster {
  sent: BroadcastMessage[] = [];
  broadcast(messages: BroadcastMessage[]): Promise<void> {
    this.sent.push(...messages);
    return Promise.resolve();
  }
}

class FailingBroadcaster implements Broadcaster {
  broadcast(): Promise<void> {
    return Promise.reject(new Error('provider down'));
  }
}

const sampleRow = {
  id: '1',
  event_id: 'evt-1',
  event_type: 'InventoryConsumed',
  household_id: 'hh-1',
  payload_json: { revision: 5 },
  attempt_count: 0,
};

describe('OutboxProcessor', () => {
  it('broadcasts claimed events and marks them processed', async () => {
    const client = makeClient([sampleRow]);
    const broadcaster = new OkBroadcaster();
    const processor = new OutboxProcessor(makePool(client), broadcaster, 50, 8);

    const result = await processor.processBatch();

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(broadcaster.sent).toEqual([
      { householdId: 'hh-1', eventType: 'InventoryConsumed', revision: 5, eventId: 'evt-1' },
    ]);
    expect(client.calls.some((c) => c.text.includes('set processed_at = now()'))).toBe(true);
    expect(client.calls.some((c) => c.text === 'commit')).toBe(true);
  });

  it('returns early and commits when no events are pending', async () => {
    const client = makeClient([]);
    const processor = new OutboxProcessor(makePool(client), new OkBroadcaster(), 50, 8);
    const result = await processor.processBatch();
    expect(result.processed).toBe(0);
    expect(client.calls.some((c) => c.text.includes('set processed_at'))).toBe(false);
  });

  it('reschedules with backoff on broadcast failure (not yet at max attempts)', async () => {
    const client = makeClient([{ ...sampleRow, attempt_count: 1 }]);
    const processor = new OutboxProcessor(makePool(client), new FailingBroadcaster(), 50, 8);

    const result = await processor.processBatch();

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 });
    const retryCall = client.calls.find((c) =>
      c.text.includes('available_at = now() + make_interval'),
    );
    expect(retryCall).toBeDefined();
    // attempt 2 -> 4s backoff
    expect(retryCall?.values).toContain(4);
  });

  it('dead-letters after reaching max attempts', async () => {
    const client = makeClient([{ ...sampleRow, attempt_count: 7 }]);
    const processor = new OutboxProcessor(makePool(client), new FailingBroadcaster(), 50, 8);

    const result = await processor.processBatch();

    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 1 });
    expect(client.calls.some((c) => c.text.includes('dead_lettered_at = now()'))).toBe(true);
  });
});
