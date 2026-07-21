import { describe, expect, it } from 'vitest';
import { normalizeFoodAliases } from './food-knowledge.service';

describe('normalizeFoodAliases', () => {
  it('trims, de-duplicates, and excludes the canonical name', () => {
    expect(normalizeFoodAliases('黑虎虾', [' 大虾 ', '黑虎虾', '大虾', '虎虾'])).toEqual(['大虾', '虎虾']);
  });
});
