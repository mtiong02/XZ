/**
 * 领域错误分类（docs/07 §6）：Validation、Authorization、Conflict、Dependency、Internal。
 * 每个错误有稳定 code，由 HTTP 层映射为 Problem Details。
 */

export type DomainErrorKind = 'VALIDATION' | 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND';

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InsufficientInventoryError extends DomainError {
  constructor(foodId: string, requested: string, available: string, unit: string) {
    super(
      'CONFLICT',
      'INVENTORY_INSUFFICIENT',
      `Requested ${requested} ${unit} but only ${available} ${unit} available.`,
      { food_id: foodId, requested, available, unit },
    );
  }
}

export class UnitMismatchError extends DomainError {
  constructor(fromUnit: string, toUnit: string) {
    super(
      'VALIDATION',
      'UNIT_MISMATCH',
      `Cannot convert quantity from '${fromUnit}' to '${toUnit}'.`,
      { from_unit: fromUnit, to_unit: toUnit },
    );
  }
}

export class AlreadyReversedError extends DomainError {
  constructor(transactionId: string) {
    super('CONFLICT', 'TRANSACTION_ALREADY_REVERSED', 'Transaction has already been reversed.', {
      transaction_id: transactionId,
    });
  }
}

export class NotReversibleError extends DomainError {
  constructor(transactionId: string, reason: string) {
    super('CONFLICT', 'TRANSACTION_NOT_REVERSIBLE', reason, { transaction_id: transactionId });
  }
}
