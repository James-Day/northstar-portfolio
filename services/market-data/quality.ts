import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';

export type CandidatePrice = {
  instrumentId: string;
  tradingDate: IsoDate;
  close: DecimalString;
};

export type PriceIssue = {
  instrumentId: string;
  tradingDate: IsoDate;
  reason: 'duplicate_date' | 'invalid_close' | 'extreme_close_change';
  detail: string;
};

export type PriceQualityResult = {
  accepted: CandidatePrice[];
  quarantined: Array<CandidatePrice & { issues: PriceIssue[] }>;
};

/**
 * Screens candidate unadjusted closes before they are published. It is a guard,
 * not a split detector: extreme moves are quarantined for evidence-based review.
 */
export function inspectPriceRecords(records: CandidatePrice[], extremeMoveThreshold = new Decimal('0.8')): PriceQualityResult {
  const sorted = [...records].sort((left, right) => left.instrumentId.localeCompare(right.instrumentId) || left.tradingDate.localeCompare(right.tradingDate));
  const issues = new Map<string, PriceIssue[]>();
  const keyFor = (record: CandidatePrice) => `${record.instrumentId}:${record.tradingDate}`;
  const addIssue = (record: CandidatePrice, issue: PriceIssue) => issues.set(keyFor(record), [...(issues.get(keyFor(record)) ?? []), issue]);
  const seen = new Set<string>();
  const previousByInstrument = new Map<string, CandidatePrice>();

  for (const record of sorted) {
    const key = keyFor(record);
    let close: Decimal;
    try {
      close = new Decimal(record.close);
    } catch {
      addIssue(record, { instrumentId: record.instrumentId, tradingDate: record.tradingDate, reason: 'invalid_close', detail: 'Close must be a finite numeric value.' });
      seen.add(key);
      continue;
    }
    if (!close.isFinite()) {
      addIssue(record, { instrumentId: record.instrumentId, tradingDate: record.tradingDate, reason: 'invalid_close', detail: 'Close must be a finite numeric value.' });
      seen.add(key);
      continue;
    }
    if (close.lte(0)) addIssue(record, { instrumentId: record.instrumentId, tradingDate: record.tradingDate, reason: 'invalid_close', detail: 'Close must be greater than zero.' });
    if (seen.has(key)) addIssue(record, { instrumentId: record.instrumentId, tradingDate: record.tradingDate, reason: 'duplicate_date', detail: 'More than one close exists for this instrument and date.' });
    seen.add(key);
    const previous = previousByInstrument.get(record.instrumentId);
    if (previous && close.gt(0)) {
      const ratio = close.div(previous.close).minus(1).abs();
      if (ratio.gte(extremeMoveThreshold)) addIssue(record, { instrumentId: record.instrumentId, tradingDate: record.tradingDate, reason: 'extreme_close_change', detail: `Close changed ${ratio.times(100).toFixed(2)}% from the prior stored close.` });
    }
    previousByInstrument.set(record.instrumentId, record);
  }

  const accepted: CandidatePrice[] = [];
  const quarantined: Array<CandidatePrice & { issues: PriceIssue[] }> = [];
  for (const record of sorted) {
    const recordIssues = issues.get(keyFor(record)) ?? [];
    if (recordIssues.length) quarantined.push({ ...record, issues: recordIssues });
    else accepted.push({ ...record, close: decimalString(record.close) });
  }
  return { accepted, quarantined };
}
