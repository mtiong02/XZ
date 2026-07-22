import { Injectable } from '@nestjs/common';
import { AgentToolRegistry } from './agent-tool-registry';

export interface ToolExecutionContext {
  taskId: string;
  signal?: AbortSignal | undefined;
}

/**
 * 最小统一 Tool 执行边界：校验工具存在，并保证同一任务的同一工具
 * 只有一个有效执行。业务服务仍是事实和写入边界，Tool 不直接碰数据库。
 */
@Injectable()
export class AgentToolExecutor {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly registry: AgentToolRegistry) {}

  execute<T>(
    name: string,
    context: ToolExecutionContext,
    handler: () => Promise<T> | T,
  ): Promise<T> {
    const contract = this.registry.get(name);
    if (!contract) throw new Error(`Unknown agent tool: ${name}`);
    if (context.signal?.aborted) return Promise.reject(new Error('AGENT_TASK_CANCELLED'));

    const key = `${context.taskId}:${name}`;
    const current = this.inFlight.get(key);
    if (current) return current as Promise<T>;

    const promise = Promise.resolve().then(async () => {
      if (context.signal?.aborted) throw new Error('AGENT_TASK_CANCELLED');
      const value = await handler();
      if (context.signal?.aborted) throw new Error('AGENT_TASK_CANCELLED');
      return value;
    });
    this.inFlight.set(key, promise);
    void promise.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return promise;
  }
}
