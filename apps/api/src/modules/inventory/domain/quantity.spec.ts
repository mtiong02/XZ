import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import {
  convertQuantity,
  normalizeQuantityForStorage,
  parseQuantity,
  type UnitMap,
} from './quantity';
import { DomainError, UnitMismatchError } from './errors';

const units: UnitMap = new Map([
  ['g', { code: 'g', kind: 'MASS', baseFactor: '1' }],
  ['kg', { code: 'kg', kind: 'MASS', baseFactor: '1000' }],
  ['jin', { code: 'jin', kind: 'MASS', baseFactor: '500' }],
  ['ml', { code: 'ml', kind: 'VOLUME', baseFactor: '1' }],
  ['l', { code: 'l', kind: 'VOLUME', baseFactor: '1000' }],
  ['piece', { code: 'piece', kind: 'COUNT', baseFactor: '1' }],
  ['box', { code: 'box', kind: 'COUNT', baseFactor: '1' }],
]);

describe('parseQuantity', () => {
  it('parses valid decimal strings', () => {
    expect(parseQuantity('2').toString()).toBe('2');
    expect(parseQuantity('0.5').toString()).toBe('0.5');
  });

  it('rejects negative, non-numeric and float-noise input', () => {
    for (const bad of ['-1', 'abc', '1,5', '1.12345', '']) {
      expect(() => parseQuantity(bad)).toThrow(DomainError);
    }
  });
});

describe('normalizeQuantityForStorage', () => {
  it('stores 3 斤 as 1500 克', () => {
    const result = normalizeQuantityForStorage(new Big('3'), 'jin', units);
    expect(result.unit).toBe('g');
    expect(result.quantity.toString()).toBe('1500');
  });

  it('keeps non-convertible count units independent', () => {
    const result = normalizeQuantityForStorage(new Big('2'), 'box', units);
    expect(result.unit).toBe('box');
    expect(result.quantity.toString()).toBe('2');
  });
});

describe('convertQuantity', () => {
  it('converts within MASS kind (kg -> g)', () => {
    expect(convertQuantity(new Big('1.5'), 'kg', 'g', units).toString()).toBe('1500');
  });

  it('converts within VOLUME kind (ml -> l)', () => {
    expect(convertQuantity(new Big('500'), 'ml', 'l', units).toString()).toBe('0.5');
  });

  it('returns value unchanged for the same unit', () => {
    expect(convertQuantity(new Big('3'), 'piece', 'piece', units).toString()).toBe('3');
  });

  it('refuses COUNT-to-COUNT conversion (box vs piece must be user-confirmed)', () => {
    expect(() => convertQuantity(new Big('1'), 'box', 'piece', units)).toThrow(UnitMismatchError);
  });

  it('refuses cross-kind conversion (g -> ml)', () => {
    expect(() => convertQuantity(new Big('100'), 'g', 'ml', units)).toThrow(UnitMismatchError);
  });
});
