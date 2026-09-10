import { describe, expect, it } from 'vitest';
import { createPriceCorrection, resolveAuthoritativeClose } from '@/services/market-data/price-corrections';

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
});
