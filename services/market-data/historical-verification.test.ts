import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { verifyHistoricalCases } from '@/services/market-data/historical-verification';

const close = (symbol: string, date: string, value: string, revision = 'fixture-revision') => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub' as const, sourceRevision: revision });
const caseOf = (symbol: string, date: string, value: string, category: 'large_cap' | 'etf' | 'delisted' | 'ticker_transition' | 'split_boundary', evidence = 'operator-supplied independent record') => ({ symbol, tradingDate: isoDate(date), expectedClose: decimalString(value), category, evidence });

describe('historical source verification', () => {
  it('records expected and actual values plus source provenance for every passing case', () => {
    const records = [close('AAPL', '2024-01-02', '185.64', 'dolt-rev-7'), close('SPY', '2024-01-02', '472.65', 'dolt-rev-7')];
    const result = verifyHistoricalCases(records, [
      caseOf('aapl', '2024-01-02', '185.64', 'large_cap'), caseOf('SPY', '2024-01-02', '472.65', 'etf'),
    ]);
    expect(result).toMatchObject({ checked: 2, passed: 2, mismatches: [] });
    expect(result.checks).toEqual([
      expect.objectContaining({ symbol: 'AAPL', expectedClose: '185.64', actualClose: '185.64', category: 'large_cap', status: 'passed', reason: null, source: 'dolthub', sourceRevision: 'dolt-rev-7' }),
      expect.objectContaining({ symbol: 'SPY', expectedClose: '472.65', actualClose: '472.65', category: 'etf', status: 'passed', reason: null, source: 'dolthub', sourceRevision: 'dolt-rev-7' }),
    ]);
    expect(records[0].close).toBe('185.64');
  });

  it('reports missing and mismatched cases with their evidence metadata', () => {
    const result = verifyHistoricalCases([close('META', '2022-06-09', '184')], [
      caseOf('META', '2022-06-09', '183', 'ticker_transition', 'independent record A'), caseOf('OLD', '2020-12-31', '12', 'delisted', 'independent record B'),
    ]);
    expect(result.passed).toBe(0);
    expect(result.mismatches).toEqual([
      expect.objectContaining({ symbol: 'META', reason: 'close_mismatch', actualClose: '184', evidence: 'independent record A', source: 'dolthub', sourceRevision: 'fixture-revision' }),
      expect.objectContaining({ symbol: 'OLD', reason: 'missing', actualClose: null, evidence: 'independent record B', source: null, sourceRevision: null }),
    ]);
    expect(result.checks).toHaveLength(2);
  });

  it('distinguishes duplicate source records from a missing close', () => {
    const result = verifyHistoricalCases([close('AAPL', '2024-01-02', '185.64'), close('AAPL', '2024-01-02', '185.64')], [caseOf('AAPL', '2024-01-02', '185.64', 'large_cap')]);
    expect(result).toMatchObject({ passed: 0, mismatches: [expect.objectContaining({ reason: 'duplicate', actualClose: null })] });
    expect(result.checks[0]).toMatchObject({ status: 'mismatch', reason: 'duplicate', source: null, sourceRevision: null });
  });

  it('keeps split-boundary and delisted categories in the same auditable report', () => {
    const result = verifyHistoricalCases([close('XYZ', '2020-08-31', '100'), close('OLD', '2019-01-02', '10')], [
      caseOf('XYZ', '2020-08-31', '100', 'split_boundary'), caseOf('OLD', '2019-01-02', '10', 'delisted'),
    ]);
    expect(result.checks.map(({ category, status }) => ({ category, status }))).toEqual([
      { category: 'split_boundary', status: 'passed' }, { category: 'delisted', status: 'passed' },
    ]);
  });
});
