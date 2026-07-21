import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import { allocateFefo, sortLotsFefo, type LotSnapshot } from './fefo';
import { InsufficientInventoryError } from './errors';

function lot(
  id: string,
  remaining: string,
  expiresAt: string | null,
  createdAt: string,
): LotSnapshot {
  return {
    id,
    remainingQuantity: new Big(remaining),
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdAt: new Date(createdAt),
  };
}

describe('sortLotsFefo', () => {
  it('orders earliest expiry first, null expiry last, then FIFO by creation', () => {
    const lots = [
      lot('no-expiry-old', '1', null, '2026-07-01T00:00:00Z'),
      lot('late', '1', '2026-08-01T00:00:00Z', '2026-07-02T00:00:00Z'),
      lot('early', '1', '2026-07-25T00:00:00Z', '2026-07-03T00:00:00Z'),
      lot('no-expiry-new', '1', null, '2026-07-04T00:00:00Z'),
    ];
    expect(sortLotsFefo(lots).map((l) => l.id)).toEqual([
      'early',
      'late',
      'no-expiry-old',
      'no-expiry-new',
    ]);
  });
});

describe('allocateFefo', () => {
  it('consumes from the earliest-expiring lot first', () => {
    const lots = [
      lot('late', '10', '2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      lot('early', '3', '2026-07-25T00:00:00Z', '2026-07-02T00:00:00Z'),
    ];
    const allocations = allocateFefo('food_egg', 'piece', lots, new Big('2'));
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.lotId).toBe('early');
    expect(allocations[0]?.quantity.toString()).toBe('2');
    expect(allocations[0]?.depletes).toBe(false);
  });

  it('spans multiple lots and marks depleted lots', () => {
    const lots = [
      lot('early', '3', '2026-07-25T00:00:00Z', '2026-07-01T00:00:00Z'),
      lot('late', '10', '2026-08-01T00:00:00Z', '2026-07-02T00:00:00Z'),
    ];
    const allocations = allocateFefo('food_egg', 'piece', lots, new Big('5'));
    expect(allocations.map((a) => [a.lotId, a.quantity.toString(), a.depletes])).toEqual([
      ['early', '3', true],
      ['late', '2', false],
    ]);
  });

  it('rejects when total available is insufficient — no partial execution', () => {
    const lots = [lot('only', '1', '2026-07-25T00:00:00Z', '2026-07-01T00:00:00Z')];
    expect(() => allocateFefo('food_egg', 'piece', lots, new Big('2'))).toThrow(
      InsufficientInventoryError,
    );
  });

  it('handles exact depletion across all lots', () => {
    const lots = [
      lot('a', '1.5', '2026-07-25T00:00:00Z', '2026-07-01T00:00:00Z'),
      lot('b', '0.5', '2026-08-01T00:00:00Z', '2026-07-02T00:00:00Z'),
    ];
    const allocations = allocateFefo('food_milk', 'l', lots, new Big('2'));
    expect(allocations.every((a) => a.depletes)).toBe(true);
  });
});
