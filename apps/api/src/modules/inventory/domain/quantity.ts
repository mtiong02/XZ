import Big from 'big.js';
import { DomainError, UnitMismatchError } from './errors';

/**
 * 数量运算：业务数量必须带单位、用 Decimal 字符串表达（AGENTS.md §4、docs/07 §4）。
 * 内部用 big.js 精确运算，输出仍为字符串。
 */

export interface UnitDef {
  code: string;
  kind: 'COUNT' | 'MASS' | 'VOLUME';
  baseFactor: string;
}

export type UnitMap = ReadonlyMap<string, UnitDef>;

const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;

export function parseQuantity(value: string): Big {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new DomainError('VALIDATION', 'INVALID_QUANTITY', `Invalid quantity '${value}'.`);
  }
  return new Big(value);
}

export function formatQuantity(value: Big): string {
  // 去掉多余的尾随零，保持稳定字符串表示
  return value.toString();
}

/**
 * 单位换算规则：
 * - 相同单位码：不变；
 * - 同为 MASS 或 VOLUME：按 base_factor 换算（kg -> g、l -> ml）；
 * - COUNT 单位（个/盒/包…）彼此不可自动换算，必须由用户修正。
 */
export function convertQuantity(value: Big, fromUnit: string, toUnit: string, units: UnitMap): Big {
  if (fromUnit === toUnit) {
    return value;
  }
  const from = units.get(fromUnit);
  const to = units.get(toUnit);
  if (!from || !to) {
    throw new DomainError(
      'VALIDATION',
      'UNKNOWN_UNIT',
      `Unknown unit '${!from ? fromUnit : toUnit}'.`,
    );
  }
  if (from.kind !== to.kind || from.kind === 'COUNT') {
    throw new UnitMismatchError(fromUnit, toUnit);
  }
  return value.times(new Big(from.baseFactor)).div(new Big(to.baseFactor));
}

/**
 * 库存允许同一食材同时存在不同计量维度（例如土豆既有“个”也有“克”）。
 * 重量统一存克、体积统一存毫升；不可换算的计数单位按原单位分别保存。
 */
export function normalizeQuantityForStorage(
  value: Big,
  fromUnit: string,
  units: UnitMap,
): { quantity: Big; unit: string } {
  const source = units.get(fromUnit);
  if (!source) {
    throw new DomainError('VALIDATION', 'UNKNOWN_UNIT', `Unknown unit '${fromUnit}'.`);
  }
  const targetUnit = source.kind === 'MASS' ? 'g' : source.kind === 'VOLUME' ? 'ml' : fromUnit;
  return { quantity: convertQuantity(value, fromUnit, targetUnit, units), unit: targetUnit };
}
