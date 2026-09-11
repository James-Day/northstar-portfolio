import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { verifyHistoricalCases } from '@/services/market-data/historical-verification';

const close = (symbol: string, date: string, value: string) => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub' as const, sourceRevision: 'fixture-revision' });

describe('historical source verification', () => {
  it('matches independent fixtures without adjusting or mutating source records', () => {
    const records = [close('AAPL', '2024-01-02', '185.64'), close('SPY', '2024-01-02', '472.65')];
    const result = verifyHistoricalCases(records, [
      { symbol: 'aapl', tradingDate: isoDate('2024-01-02'), expectedClose: decimalString('185.64'), category: 'large_cap', evidence: 'issuer or independent historical record' },
      { symbol: 'SPY', tradingDate: isoDate('2024-01-02'), expectedClose: decimalString('472.65'), category: 'etf', evidence: 'independent historical record' },
    ]);
    expect(result).toMatchObject({ checked: 2, passed: 2, mismatches: [] });
    expect(records[0].close).toBe('185.64');
  });

  it('reports missing and mismatched cases with their evidence metadata', () => {
    const result = verifyHistoricalCases([close('META', '2022-06-09', '184')], [
      { symbol: 'META', tradingDate: isoDate('2022-06-09'), expectedClose: decimalString('183'), category: 'ticker_transition', evidence: 'independent record A' },
      { symbol: 'OLD', tradingDate: isoDate('2020-12-31'), expectedClose: decimalString('12'), category: 'delisted', evidence: 'independent record B' },
    ]);
    expect(result.passed).toBe(0);
    expect(result.mismatches).toEqual([
      expect.objectContaining({ symbol: 'META', reason: 'close_mismatch', actualClose: '184', evidence: 'independent record A' }),
      expect.objectContaining({ symbol: 'OLD', reason: 'missing', actualClose: null, evidence: 'independent record B' }),
    ]);
  });
});
