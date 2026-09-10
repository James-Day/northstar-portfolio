import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { composePersistedReportInputs } from '@/services/reporting/compose-report-inputs';

const instrument = '33333333-3333-4333-8333-333333333333';
const replay = {
  events: [{ id: 'buy-1', date: isoDate('2026-01-01'), type: 'buy' as const, instrumentId: instrument, quantity: decimalString('2'), grossAmount: decimalString('100'), fee: decimalString('0') }],
  openingLots: [],
  activityCoveredThrough: isoDate('2026-01-01'),
  sourceEntryIds: ['entry-b', 'entry-a', 'entry-a'],
};

describe('composePersistedReportInputs', () => {
  it('connects replay, calendar, validated actions, and selected stored prices', () => {
    const result = composePersistedReportInputs({
      replay,
      dates: [{ date: isoDate('2026-01-01'), canChainFromPrevious: false }, { date: isoDate('2026-01-02'), canChainFromPrevious: true }],
      closes: [
        { instrumentId: instrument as never, tradingDate: isoDate('2026-01-02'), close: decimalString('60'), source: 'marketstack', sourceRevision: 'r2' },
        { instrumentId: instrument as never, tradingDate: isoDate('2026-01-01'), close: decimalString('50'), source: 'dolthub', sourceRevision: 'r1' },
        { instrumentId: 'other' as never, tradingDate: isoDate('2026-01-02'), close: decimalString('999'), source: 'dolthub', sourceRevision: 'r1' },
      ],
      corporateActions: [{ instrumentId: instrument, type: 'split', status: 'validated', ratioNumerator: decimalString('2'), ratioDenominator: decimalString('1'), effectiveDate: isoDate('2026-01-02') }],
    });

    expect(result.valuation.events).toEqual(replay.events);
    expect(result.valuation.dates[1].canChainFromPrevious).toBe(true);
    expect(result.valuation.closes.map((close) => close.tradingDate)).toEqual(['2026-01-01', '2026-01-02']);
    expect(result.valuation.closes).toHaveLength(2);
    expect(result.valuation.corporateActions[0].status).toBe('validated');
    expect(result.ledger.cash).toBe('-100');
    expect(result.ledger.openLots[0].remainingQuantity).toBe('2');
    expect(result.activityCoveredThrough).toBe('2026-01-01');
    expect(result.pricesThrough).toBe('2026-01-02');
    expect(result.importStateRevision).toBe('ledger:entry-a,entry-b');
  });

  it('does not invent price coverage when no selected close exists', () => {
    const result = composePersistedReportInputs({ replay, dates: [{ date: isoDate('2026-01-03'), canChainFromPrevious: false }], closes: [] });
    expect(result.valuation.closes).toEqual([]);
    expect(result.pricesThrough).toBeNull();
  });
});
