import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';
import type { AgentEventInput } from './agent-runtime.types';

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async recordEvent(input: AgentEventInput): Promise<void> {
    try {
      await this.pool.query(
        `insert into agent_events
          (household_id, actor_member_id, session_id, turn_id, task_id,
           event_type, intent, outcome, latency_ms, metadata)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
           $6, $7, $8, $9, $10::jsonb)`,
        [
          input.householdId,
          input.actorMemberId ?? null,
          input.sessionId ?? null,
          input.turnId ?? null,
          input.taskId ?? null,
          input.eventType,
          input.intent ?? null,
          input.outcome ?? null,
          input.latencyMs ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    } catch (error) {
      // Telemetry must never block a household action if the table is not yet migrated.
      this.logger.warn(`Agent event skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
