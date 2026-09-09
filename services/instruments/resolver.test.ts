import { describe, expect, it } from 'vitest';
import { isoDate, type InstrumentId } from '@/lib/domain/types';
import { resolveInstrumentAlias } from '@/services/instruments/resolver';

describe('instrument alias resolver', () => {
  const meta = 'instrument-meta' as InstrumentId;
  const aliases = [
    { instrumentId: meta, symbol: 'FB', effectiveFrom: isoDate('2012-05-18'), effectiveTo: isoDate('2022-06-08') },
    { instrumentId: meta, symbol: 'META', effectiveFrom: isoDate('2022-06-09'), effectiveTo: null },
  ];

  it('uses effective dates so a ticker change retains the stable instrument identity', () => {
    expect(resolveInstrumentAlias(aliases, 'fb', isoDate('2020-01-02'))).toBe(meta);
    expect(resolveInstrumentAlias(aliases, 'META', isoDate('2023-01-02'))).toBe(meta);
    expect(resolveInstrumentAlias(aliases, 'FB', isoDate('2023-01-02'))).toBeUndefined();
  });

  it('fails closed for overlapping aliases', () => {
    expect(() => resolveInstrumentAlias([...aliases, { instrumentId: 'wrong' as InstrumentId, symbol: 'META', effectiveFrom: isoDate('2022-06-09'), effectiveTo: null }], 'META', isoDate('2023-01-02'))).toThrow('ambiguous');
  });
});
