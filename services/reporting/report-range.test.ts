import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/domain/types';
import { decimalString } from '@/lib/domain/money';
import { resolveReportRange } from './report-range';

describe('resolveReportRange', () => {
  it('derives the start from the earliest committed activity and uses the supplied end', () => {
    expect(resolveReportRange({ job: { kind: 'report.recompute', accountId: 'account', requestedBy: 'user', reason: 'price_updated' }, replay: { events: [{ id: 'event', date: isoDate('2026-01-05'), type: 'deposit', amount: decimalString('100') }], openingLots: [], activityCoveredThrough: isoDate('2026-01-05'), sourceEntryIds: ['event'] }, through: isoDate('2026-01-09') })).toEqual({ from: '2026-01-05', through: '2026-01-09' });
  });

  it('uses the supplied end for empty histories and enforces the lookback bound', () => {
    const replay = { events: [], openingLots: [], activityCoveredThrough: null, sourceEntryIds: [] };
    expect(resolveReportRange({ job: { kind: 'report.recompute', accountId: 'account', requestedBy: 'user', reason: 'price_updated' }, replay, through: isoDate('2026-01-09') })).toEqual({ from: '2026-01-09', through: '2026-01-09' });
    expect(() => resolveReportRange({ job: { kind: 'report.recompute', accountId: 'account', requestedBy: 'user', reason: 'price_updated' }, replay: { ...replay, events: [{ id: 'event', date: isoDate('2020-01-01'), type: 'deposit', amount: decimalString('100') }] }, through: isoDate('2026-01-09'), maxDays: 30 })).toThrow('lookback');
  });
});
