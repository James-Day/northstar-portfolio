import { describe, expect, it } from 'vitest';
import { createPriceCorrection, resolveAuthoritativeClose, selectAuthoritativePrices } from '@/services/market-data/price-corrections';

describe('price corrections', () => {
  const original = { instrumentId: 'instrument-a' as never, tradingDate: '2024-01-02' as never, close: '100' as never, source: 'dolthub' as const, sourceRevision: 'source-rev' };

  it('requires evidence and creates a manual-correction revision', () => {
    const correction = createPriceCorrection({ instrumentId: 'instrument-a' as never, tradingDate: '2024-01-02' as never, correctedClose: '101.25', evidence: 'Issuer split filing page 4', correctionVersion: 'correction-2' });
    expect(resolveAuthoritativeClose(original, [correction]).authoritative).toMatchObject({ close: '101.25', source: 'manual_correction', sourceRevision: 'correction-2' });
  });

  it('keeps the source close when no correction matches', () => {
    const correction = createPriceCorrection({ instrumentId: 'instrument-b' as never, tradingDate: '2024-01-02' as never, correctedClose: 101, evidence: 'Issuer filing', correctionVersion: 'correction-1' });
    expect(resolveAuthoritativeClose(original, [correction]).authoritative).toBe(original);
  });

  it('rejects missing evidence and non-positive closes', () => {
    expect(() => createPriceCorrection({ instrumentId: 'instrument-a' as never, tradingDate: '2024-01-02' as never, correctedClose: 0, evidence: 'filing', correctionVersion: 'v1' })).toThrow('greater than zero');
    expect(() => createPriceCorrection({ instrumentId: 'instrument-a' as never, tradingDate: '2024-01-02' as never, correctedClose: 1, evidence: ' ', correctionVersion: 'v1' })).toThrow('evidence');
  });

  it('selects provider revisions deterministically and records correction dependencies', () => {
    const result = selectAuthoritativePrices([
      { ...original, close: '99' as never, source: 'dolthub', sourceRevision: 'rev-9' },
      { ...original, close: '100' as never, source: 'dolthub', sourceRevision: 'rev-10' },
      { ...original, close: '101' as never, source: 'marketstack', sourceRevision: '2024-01-02' },
    ]);
    expect(result.closes).toEqual([{ ...original, close: '101', source: 'marketstack', sourceRevision: '2024-01-02' }]);
    expect(result.dependencies).toEqual([{ instrumentId: original.instrumentId, tradingDate: original.tradingDate, source: 'marketstack', sourceRevision: '2024-01-02', correctionVersion: null }]);

    const correction = createPriceCorrection({ instrumentId: original.instrumentId, tradingDate: original.tradingDate, correctedClose: '102', evidence: 'Issuer filing', correctionVersion: 'correction-2' });
    const corrected = selectAuthoritativePrices([original], [correction]);
    expect(corrected.closes[0]).toMatchObject({ close: '102', source: 'manual_correction', sourceRevision: 'correction-2' });
    expect(corrected.dependencies[0]).toMatchObject({ source: 'dolthub', sourceRevision: 'source-rev', correctionVersion: 'correction-2' });
  });

  it('fails closed when a version key carries conflicting values', () => {
    expect(() => selectAuthoritativePrices([
      { ...original, close: '100' as never, sourceRevision: 'same-revision' },
      { ...original, close: '101' as never, sourceRevision: 'same-revision' },
    ])).toThrow('Ambiguous dolthub price revision same-revision');

    const first = createPriceCorrection({ instrumentId: original.instrumentId, tradingDate: original.tradingDate, correctedClose: '102', evidence: 'Filing A', correctionVersion: 'same-version' });
    const second = { ...first, correctedClose: '103' as never };
    expect(() => selectAuthoritativePrices([original], [first, second])).toThrow('Ambiguous manual correction version same-version');
  });
});
