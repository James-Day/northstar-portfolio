import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { calculateConsolidatedReport, type ConsolidatedAccountInput } from '@/services/reporting/consolidated';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import type { ValuationDate } from '@/services/calculations/valuation';

const instrument = 'instrument-1';
const date = (value: string) => isoDate(value);

function account(accountId: string, events: PersistedReportInputs['valuation']['events'], overrides: Partial<PersistedReportInputs['valuation']> = {}): ConsolidatedAccountInput {
  const dates: ValuationDate[] = [{ date: date('2026-01-01'), canChainFromPrevious: false }, { date: date('2026-01-02'), canChainFromPrevious: true }];
  const valuation: PersistedReportInputs['valuation'] = {
    dates,
    events,
    openingLots: [],
    closes: [
      { instrumentId: instrument as never, tradingDate: date('2026-01-01'), close: decimalString('100'), source: 'dolthub', sourceRevision: 'r1' },
      { instrumentId: instrument as never, tradingDate: date('2026-01-02'), close: decimalString('110'), source: 'marketstack', sourceRevision: 'r2' },
    ],
    corporateActions: [],
  };
  Object.assign(valuation, overrides);
  return { accountId, inputs: { valuation, ledger: { cash: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('0'), realizedGainLoss: decimalString('0'), sales: [], openLots: [] }, activityCoveredThrough: date('2026-01-02'), pricesThrough: date('2026-01-02'), importStateRevision: accountId } };
}

describe('consolidated reporting', () => {
  it('cancels only a proven internal cash transfer while retaining external deposits', () => {
    const result = calculateConsolidatedReport({
      accounts: [
        account('taxable', [
          { id: 'deposit', date: date('2026-01-01'), type: 'deposit', amount: decimalString('100') },
          { id: 'out', date: date('2026-01-01'), type: 'transfer_out', amount: decimalString('100') },
        ]),
        account('ira', [{ id: 'in', date: date('2026-01-01'), type: 'transfer_in', amount: decimalString('100') }]),
      ],
      links: [{ transferGroupId: 'move', outgoingId: 'out', incomingId: 'in' }],
    });

    expect(result.inputs.valuation.events.map((event) => event.id)).toEqual(['deposit']);
    expect(result.inputs.ledger.netDeposits).toBe('100');
    expect(result.inputs.ledger.cash).toBe('100');
    expect(result.inputs.unresolvedTransfers).toEqual([]);
    expect(result.history.valuations[0]).toMatchObject({ totalValue: '100', externalFlows: '100' });
  });

  it('keeps unresolved links visible and does not claim complete transfer reconciliation', () => {
    const result = calculateConsolidatedReport({
      accounts: [account('taxable', [{ id: 'out', date: date('2026-01-01'), type: 'transfer_out', amount: decimalString('100') }])],
      links: [{ transferGroupId: 'missing', outgoingId: 'out', incomingId: 'absent' }],
    });
    expect(result.inputs.valuation.events).toHaveLength(1);
    expect(result.inputs.unresolvedTransfers).toEqual([expect.objectContaining({ transferGroupId: 'missing', ids: ['absent', 'out'] })]);
  });

  it('preserves unknown cost basis and missing valuation periods', () => {
    const result = calculateConsolidatedReport({
      accounts: [account('ira', [
        { id: 'sell', date: date('2026-01-02'), type: 'sell', instrumentId: instrument, quantity: decimalString('1'), grossAmount: decimalString('110'), fee: decimalString('0') },
      ], {
        openingLots: [{ id: 'opening', instrumentId: instrument, acquiredOn: null, quantity: decimalString('1'), totalCostBasis: null }],
        closes: [{ instrumentId: instrument as never, tradingDate: date('2026-01-02'), close: decimalString('110'), source: 'marketstack', sourceRevision: 'r2' }],
      })],
    });
    expect(result.inputs.ledger.realizedGainLoss).toBeNull();
    expect(result.inputs.ledger.sales[0]).toMatchObject({ basisKnown: false, matchedCostBasis: null, gainLoss: null });
    expect(result.history.valuations[0].totalValue).toBeNull();
    expect(result.history.timeWeightedReturn).toBeNull();
  });
});
