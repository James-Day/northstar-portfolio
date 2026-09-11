import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { valueLedgerHistory } from '@/services/calculations/valuation';
import { buildReportSnapshotPayload } from '@/services/reporting/snapshot-builder';

describe('report snapshot builder', () => {
  it('publishes the latest exact-decimal valuation and records unavailable dates', () => {
    const history = valueLedgerHistory({ dates: [{ date: isoDate('2026-01-01'), canChainFromPrevious: true }, { date: isoDate('2026-01-02'), canChainFromPrevious: true }], events: [{ id: 'deposit-1', date: isoDate('2026-01-01'), type: 'deposit', amount: decimalString('100') }, { id: 'buy-1', date: isoDate('2026-01-01'), type: 'buy', instrumentId: 'instrument-a', quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') }], closes: [{ instrumentId: 'instrument-a' as never, tradingDate: isoDate('2026-01-01'), close: decimalString('100'), source: 'dolthub', sourceRevision: 'rev-1' }, { instrumentId: 'instrument-a' as never, tradingDate: isoDate('2026-01-02'), close: decimalString('110'), source: 'dolthub', sourceRevision: 'rev-1' }] });
    expect(buildReportSnapshotPayload({ history, activityCoveredThrough: isoDate('2026-01-01'), pricesThrough: isoDate('2026-01-02') })).toMatchObject({ activityCoveredThrough: '2026-01-01', valuationThrough: '2026-01-02', pricesThrough: '2026-01-02', totalValue: '110', cash: '0', timeWeightedReturn: '0.1', valueHistory: [{ date: '2026-01-01', value: '100' }, { date: '2026-01-02', value: '110' }], unavailableDates: [{ date: '2026-01-01' }], methodology: { returnMethod: 'daily_modified_dietz_chained', externalFlowTiming: 'midpoint_approximation', annualized: false, gapHandling: 'unavailable', taxReporting: false } });
  });

  it('publishes the gap as unavailable instead of implying a bridged or annualized return', () => {
    const history = valueLedgerHistory({ dates: [{ date: isoDate('2026-01-01'), canChainFromPrevious: true }, { date: isoDate('2026-01-05'), canChainFromPrevious: false }], events: [], closes: [] });
    const payload = buildReportSnapshotPayload({ history, activityCoveredThrough: null, pricesThrough: null });
    expect(payload.timeWeightedReturn).toBeNull();
    expect(payload.unavailableDates).toContainEqual({ date: isoDate('2026-01-05'), reason: 'non_contiguous_period' });
    expect(payload.methodology.annualized).toBe(false);
    expect(payload.methodology.taxReporting).toBe(false);
  });

  it('carries exact ledger income, realized gain/loss, and deposits into the payload', () => {
    const history = valueLedgerHistory({ dates: [{ date: isoDate('2026-01-01'), canChainFromPrevious: true }], events: [], closes: [] });
    expect(buildReportSnapshotPayload({ history, activityCoveredThrough: null, pricesThrough: null, ledger: { netDeposits: '100' as never, dividendIncome: '4.25' as never, realizedGainLoss: '-2.5' as never } })).toMatchObject({ netDeposits: '100', dividendIncome: '4.25', realizedGainLoss: '-2.5' });
  });

  it('retains dividend event detail alongside the aggregate income total', () => {
    const history = valueLedgerHistory({ dates: [{ date: isoDate('2026-01-01'), canChainFromPrevious: true }], events: [], closes: [] });
    const payload = buildReportSnapshotPayload({
      history,
      activityCoveredThrough: null,
      pricesThrough: null,
      ledger: {
        netDeposits: '0' as never,
        dividendIncome: '10' as never,
        realizedGainLoss: '0' as never,
        dividendEvents: [{ eventId: 'dividend-1', date: isoDate('2026-01-01'), instrumentId: 'instrument-vti', amount: '10' as never }],
      },
    });
    expect(payload.dividends).toEqual([{ eventId: 'dividend-1', date: '2026-01-01', instrumentId: 'instrument-vti', amount: '10' }]);
  });
});
