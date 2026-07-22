import { Injectable } from '@nestjs/common';
import type { AgentToolContract } from './agent-runtime.types';

@Injectable()
export class AgentToolRegistry {
  private readonly contracts: ReadonlyMap<string, AgentToolContract>;

  constructor() {
    const contracts: AgentToolContract[] = [
      {
        name: 'inventory.read',
        description: '读取当前家庭库存及临期食材',
        input: 'household_id, optional category/expiry filters',
        output: 'inventory snapshot',
        risk: 'READ_ONLY',
        reversible: true,
        requiredPermissions: ['household:read'],
        confirmation: 'NONE',
      },
      {
        name: 'meal.recommend',
        description: '根据库存、人数、偏好和临期情况生成餐食方案',
        input: 'meal decision context',
        output: 'meal plan draft with portions and missing ingredients',
        risk: 'READ_ONLY',
        reversible: true,
        requiredPermissions: ['household:read', 'inventory:read'],
        confirmation: 'NONE',
      },
      {
        name: 'shopping.draft',
        description: '把餐食缺少的食材整理为待购草稿',
        input: 'missing ingredients',
        output: 'shopping list draft',
        risk: 'DRAFT',
        reversible: true,
        requiredPermissions: ['shopping:write'],
        confirmation: 'NONE',
      },
      {
        name: 'shopping.confirm',
        description: '确认并写入家庭购物清单',
        input: 'shopping list draft',
        output: 'shopping list items',
        risk: 'REVERSIBLE_WRITE',
        reversible: true,
        requiredPermissions: ['shopping:write'],
        confirmation: 'SOFT',
      },
    ];

    if (new Set(contracts.map((contract) => contract.name)).size !== contracts.length) {
      throw new Error('Agent tool names must be unique');
    }
    this.contracts = new Map(contracts.map((contract) => [contract.name, contract]));
  }

  list(): AgentToolContract[] {
    return [...this.contracts.values()];
  }

  get(name: string): AgentToolContract | undefined {
    return this.contracts.get(name);
  }
}
