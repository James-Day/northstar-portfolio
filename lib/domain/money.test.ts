import { describe, expect, it } from 'vitest';
import { decimalAdd, decimalMultiply, decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';

describe('financial primitives', () => {
  it('keeps decimal arithmetic exact at the API boundary', () => {
    expect(decimalAdd(decimalString('0.10'), decimalString('0.20'))).toBe('0.3');
    expect(decimalMultiply(decimalString('12.5'), decimalString('0.08'))).toBe('1');
  });

  it('rejects malformed decimals and impossible calendar dates', () => {
    expect(() => decimalString('12,000')).toThrow('Invalid decimal');
    expect(() => isoDate('2026-02-30')).toThrow('Invalid calendar date');
  });
});
