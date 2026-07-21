import { log } from './log';

/**
 * 通过 Supabase Realtime Broadcast HTTP 接口向家庭频道推送变更通知。
 *
 * 安全设计：payload 只携带 household_id、event_type 和 revision，不含库存明细。
 * 客户端收到通知后，仍需通过已认证的 API 拉取 authoritative snapshot（docs/02 §11、§16）。
 * 因此即便频道被订阅，也不泄漏敏感数据。
 */
export interface BroadcastMessage {
  householdId: string;
  eventType: string;
  revision: number | null;
  eventId: string;
}

export interface Broadcaster {
  broadcast(messages: BroadcastMessage[]): Promise<void>;
}

export class SupabaseRealtimeBroadcaster implements Broadcaster {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  async broadcast(messages: BroadcastMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const response = await fetch(`${this.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages.map((message) => ({
          topic: `household:${message.householdId}`,
          event: 'inventory_changed',
          payload: {
            household_id: message.householdId,
            event_type: message.eventType,
            revision: message.revision,
            event_id: message.eventId,
          },
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Realtime broadcast failed: ${response.status} ${await response.text()}`);
    }
  }
}

/** 无 Supabase 配置时的降级实现：仅记录，不阻断 outbox 推进。 */
export class LoggingBroadcaster implements Broadcaster {
  broadcast(messages: BroadcastMessage[]): Promise<void> {
    for (const message of messages) {
      log('info', 'broadcast.skipped_no_provider', {
        household_id: message.householdId,
        event_type: message.eventType,
      });
    }
    return Promise.resolve();
  }
}
