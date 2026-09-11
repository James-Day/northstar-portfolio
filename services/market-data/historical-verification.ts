import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';

export type HistoricalVerificationCase = {
  symbol: string;
  tradingDate: IsoDate;
  expectedClose: DecimalString;
  category: 'large_cap' | 'etf' | 'delisted' | 'ticker_transition' | 'split_boundary';
  evidence: string;
};

export type HistoricalVerificationMismatch = {
  symbol: string;
  tradingDate: IsoDate;
  expectedClose: DecimalString;
  actualClose: DecimalString | null;
  category: HistoricalVerificationCase['category'];
  evidence: string;
  reason: 'missing' | 'duplicate' | 'close_mismatch';
};

/** Compares stored source closes with operator-supplied independent fixtures. */
export function verifyHistoricalCases(
  records: DoltHubDailyClose[],
  cases: HistoricalVerificationCase[],
): { checked: number; passed: number; mismatches: HistoricalVerificationMismatch[] } {
  const byKey = new Map<string, DoltHubDailyClose[]>();
  for (const record of records) {
    const key = `${record.symbol.trim().toUpperCase()}|${record.tradingDate}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }
  const mismatches = cases.map((fixture) => {
    const key = `${fixture.symbol.trim().toUpperCase()}|${fixture.tradingDate}`;
    const matches = byKey.get(key) ?? [];
    const actual = matches.length === 1 ? decimalString(matches[0].close) : null;
    if (actual !== null && actual === decimalString(fixture.expectedClose)) return null;
    return {
      symbol: fixture.symbol.trim().toUpperCase(),
      tradingDate: fixture.tradingDate,
      expectedClose: decimalString(fixture.expectedClose),
      actualClose: actual,
      category: fixture.category,
      evidence: fixture.evidence,
      reason: matches.length === 0 ? 'missing' as const : matches.length > 1 ? 'duplicate' as const : 'close_mismatch' as const,
    };
  }).filter((mismatch): mismatch is HistoricalVerificationMismatch => mismatch !== null);
  return { checked: cases.length, passed: cases.length - mismatches.length, mismatches };
}
