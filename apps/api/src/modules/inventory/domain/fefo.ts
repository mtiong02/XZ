import Big from 'big.js';
import { InsufficientInventoryError } from './errors';
import { formatQuantity } from './quantity';

/**
 * FEFO 分配（docs/01 业务规则 2）：优先扣减最早到期批次。
 * 纯函数：输入批次快照与需求量，输出各批次扣减计划或抛出库存不足。
 */

export interface LotSnapshot {
  id: string;
  remainingQuantity: Big;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface LotAllocation {
  lotId: string;
  quantity: Big;
  depletes: boolean;
}

export function sortLotsFefo(lots: readonly LotSnapshot[]): LotSnapshot[] {
  return [...lots].sort((a, b) => {
    // 有到期日的优先于无到期日；到期日早的优先；再按加入时间先入先出
    if (a.expiresAt !== null && b.expiresAt !== null) {
      const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (diff !== 0) return diff;
    } else if (a.expiresAt !== null) {
      return -1;
    } else if (b.expiresAt !== null) {
      return 1;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function allocateFefo(
  foodId: string,
  unit: string,
  lots: readonly LotSnapshot[],
  requested: Big,
): LotAllocation[] {
  const available = lots.reduce((sum, lot) => sum.plus(lot.remainingQuantity), new Big(0));
  if (available.lt(requested)) {
    throw new InsufficientInventoryError(
      foodId,
      formatQuantity(requested),
      formatQuantity(available),
      unit,
    );
  }

  const allocations: LotAllocation[] = [];
  let remaining = requested;
  for (const lot of sortLotsFefo(lots)) {
    if (remaining.lte(0)) break;
    if (lot.remainingQuantity.lte(0)) continue;
    const take = remaining.gte(lot.remainingQuantity) ? lot.remainingQuantity : remaining;
    allocations.push({
      lotId: lot.id,
      quantity: take,
      depletes: take.eq(lot.remainingQuantity),
    });
    remaining = remaining.minus(take);
  }
  return allocations;
}
