import { describe, expect, it } from 'vitest';
import { computeExpiryStatus } from './expiry';

const now = new Date('2026-07-21T00:00:00Z');

describe('computeExpiryStatus', () => {
  it('returns UNKNOWN when no expiry date', () => {
    expect(computeExpiryStatus(null, now)).toBe('UNKNOWN');
  });

  it('returns EXPIRED at or past the expiry time', () => {
    expect(computeExpiryStatus(new Date('2026-07-21T00:00:00Z'), now)).toBe('EXPIRED');
    expect(computeExpiryStatus(new Date('2026-07-20T00:00:00Z'), now)).toBe('EXPIRED');
  });

  it('returns EXPIRING within the threshold window', () => {
    expect(computeExpiryStatus(new Date('2026-07-22T12:00:00Z'), now)).toBe('EXPIRING');
    expect(computeExpiryStatus(new Date('2026-07-23T00:00:00Z'), now)).toBe('EXPIRING');
  });

  it('returns NORMAL beyond the threshold window', () => {
    expect(computeExpiryStatus(new Date('2026-07-24T00:00:01Z'), now)).toBe('NORMAL');
  });
});
