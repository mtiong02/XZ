import { describe, expect, it } from 'vitest';
import { AgentToolRegistry } from './agent-tool-registry';
import { AgentToolExecutor } from './agent-tool-executor';
import { confirmationForTool } from './confirmation-policy';
import { ContextBuilder } from './context-builder';
import { TurnCoordinatorService } from './turn-coordinator.service';

describe('agent runtime foundations', () => {
  it('defines a small, risk-aware tool contract set', () => {
    const registry = new AgentToolRegistry();
    expect(registry.list().map((tool) => tool.name)).toEqual([
      'inventory.read',
      'meal.recommend',
      'shopping.draft',
      'shopping.confirm',
    ]);
    const inventoryRead = registry.get('inventory.read');
    const shoppingConfirm = registry.get('shopping.confirm');
    if (!inventoryRead || !shoppingConfirm) throw new Error('expected tools to be registered');
    expect(confirmationForTool(inventoryRead)).toBe('NONE');
    expect(confirmationForTool(shoppingConfirm)).toBe('SOFT');
    expect(confirmationForTool(shoppingConfirm, { explicitUserConfirmation: true })).toBe('NONE');
  });

  it('builds a stable meal context from natural language and household facts', () => {
    const context = new ContextBuilder().build({
      requestText: '今晚五个人一起吃，清淡一点，优先快过期的食材',
      inventory: [{ name: '鸡胸肉' }],
      expiringItems: [{ name: '鸡胸肉' }],
      householdMemberCount: 3,
      preferences: { avoid: ['香菜'] },
    });
    expect(context.occasion).toBe('DINNER');
    expect(context.dinerCount).toBe(5);
    expect(context.diningMode).toBe('GATHERING');
    expect(context.householdMemberCount).toBe(3);
    expect(context.expiringItems).toHaveLength(1);
  });

  it('cancels the previous task before starting another for the same member', () => {
    const coordinator = new TurnCoordinatorService();
    const first = coordinator.begin({ householdId: 'h', memberId: 'm', intent: 'QUERY_INVENTORY' });
    const second = coordinator.begin({
      householdId: 'h',
      memberId: 'm',
      intent: 'MEAL_RECOMMENDATION',
    });
    expect(first.status).toBe('CANCELLED');
    expect(coordinator.getActive('h', 'm')?.taskId).toBe(second.taskId);
    coordinator.complete(second.taskId);
    expect(coordinator.getActive('h', 'm')).toBeNull();
  });

  it('executes one meal tool result per task and shares the in-flight promise', async () => {
    const executor = new AgentToolExecutor(new AgentToolRegistry());
    let calls = 0;
    const handler = async () => {
      calls += 1;
      await Promise.resolve();
      return 'single-plan';
    };
    const context = { taskId: 'task-1' };
    const [first, second] = await Promise.all([
      executor.execute('meal.recommend', context, handler),
      executor.execute('meal.recommend', context, handler),
    ]);
    expect(first).toBe('single-plan');
    expect(second).toBe('single-plan');
    expect(calls).toBe(1);
  });
});
