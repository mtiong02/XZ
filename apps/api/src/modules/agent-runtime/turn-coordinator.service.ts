import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AgentTaskStatus } from './agent-runtime.types';

export interface AgentTask {
  taskId: string;
  sessionId: string;
  turnId: string;
  householdId: string;
  memberId?: string | null | undefined;
  intent?: string | null | undefined;
  status: AgentTaskStatus;
  startedAt: string;
  readonly abortController: AbortController;
}

@Injectable()
export class TurnCoordinatorService {
  private readonly active = new Map<string, AgentTask>();

  begin(input: {
    householdId: string;
    memberId?: string | null;
    sessionId?: string;
    taskId?: string;
    intent?: string | null;
  }): AgentTask {
    const key = this.key(input.householdId, input.memberId);
    const previous = this.active.get(key);
    if (previous) {
      previous.status = 'CANCELLED';
      previous.abortController.abort();
    }
    const task: AgentTask = {
      taskId: input.taskId ?? randomUUID(),
      sessionId: input.sessionId ?? randomUUID(),
      turnId: randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      intent: input.intent,
      status: 'ACTIVE',
      startedAt: new Date().toISOString(),
      abortController: new AbortController(),
    };
    this.active.set(key, task);
    return task;
  }

  getActive(householdId: string, memberId?: string | null): AgentTask | null {
    return this.active.get(this.key(householdId, memberId)) ?? null;
  }

  resume(taskId: string): AgentTask | null {
    for (const task of this.active.values()) {
      if (task.taskId === taskId) {
        task.status = 'ACTIVE';
        return task;
      }
    }
    return null;
  }

  getSignal(taskId: string): AbortSignal | undefined {
    for (const task of this.active.values()) {
      if (task.taskId === taskId) return task.abortController.signal;
    }
    return undefined;
  }

  cancel(taskId: string): AgentTask | null {
    for (const task of this.active.values()) {
      if (task.taskId === taskId) {
        task.status = 'CANCELLED';
        task.abortController.abort();
        this.active.delete(this.key(task.householdId, task.memberId));
        return task;
      }
    }
    return null;
  }

  complete(
    taskId: string,
    status: Extract<AgentTaskStatus, 'COMPLETED' | 'CANCELLED' | 'FAILED'> = 'COMPLETED',
  ) {
    for (const [key, task] of this.active.entries()) {
      if (task.taskId === taskId) {
        task.status = status;
        this.active.delete(key);
        return task;
      }
    }
    return null;
  }

  private key(householdId: string, memberId?: string | null) {
    return `${householdId}:${memberId ?? 'household'}`;
  }
}
