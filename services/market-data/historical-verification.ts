import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';

export type HistoricalVerificationCategory = 'large_cap' | 'etf' | 'delisted' | 'ticker_transition' | 'split_boundary';

export type HistoricalVerificationCase = {
  symbol: string;
  tradingDate: IsoDate;
  expectedClose: DecimalString;
  category: HistoricalVerificationCategory;
  /** Human-readable independent source/issuer reference supplied by an operator. */
  evidence: string;
};

export type HistoricalVerificationCheck = {
  symbol: string;
  tradingDate: IsoDate;
  expectedClose: DecimalString;
  actualClose: DecimalString | null;
  category: HistoricalVerificationCategory;
  evidence: string;
  status: 'passed' | 'mismatch';
  reason: 'missing' | 'duplicate' | 'close_mismatch' | null;
  source: DoltHubDailyClose['source'] | null;
  sourceRevision: string | null;
};

export type HistoricalVerificationMismatch = Omit<HistoricalVerificationCheck, 'status'> & {
  reason: 'missing' | 'duplicate' | 'close_mismatch';
};

export type HistoricalVerificationResult = {
  checked: number;
  passed: number;
  mismatches: HistoricalVerificationMismatch[];
  /** Every case, including passes, for an auditable expected/actual report. */
  checks: HistoricalVerificationCheck[];
};

/**
 * Compares stored source closes with operator-supplied independent fixtures.
 * This is a reporting-only check: source records are never adjusted or mutated.
 */
export function verifyHistoricalCases(
  records: DoltHubDailyClose[],
  cases: HistoricalVerificationCase[],
): HistoricalVerificationResult {
  const byKey = new Map<string, DoltHubDailyClose[]>();
  for (const record of records) {
    const key = `${record.symbol.trim().toUpperCase()}|${record.tradingDate}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }

  const checks = cases.map((fixture): HistoricalVerificationCheck => {
    const symbol = fixture.symbol.trim().toUpperCase();
    const matches = byKey.get(`${symbol}|${fixture.tradingDate}`) ?? [];
    const record = matches.length === 1 ? matches[0] : null;
    const actualClose = record ? decimalString(record.close) : null;
    const expectedClose = decimalString(fixture.expectedClose);
    const passed = actualClose !== null && actualClose === expectedClose;
    const reason = passed ? null : matches.length === 0 ? 'missing' : matches.length > 1 ? 'duplicate' : 'close_mismatch';
    return {
      symbol,
      tradingDate: fixture.tradingDate,
      expectedClose,
      actualClose,
      category: fixture.category,
      evidence: fixture.evidence,
      status: passed ? 'passed' : 'mismatch',
      reason,
      source: record?.source ?? null,
      sourceRevision: record?.sourceRevision ?? null,
    };
  });
  const mismatches = checks
    .filter((check) => check.status === 'mismatch')
    .map(({ status: _status, reason, ...check }): HistoricalVerificationMismatch => ({
      ...check,
      reason: reason as HistoricalVerificationMismatch['reason'],
    }));
  return { checked: checks.length, passed: checks.length - mismatches.length, mismatches, checks };
}
