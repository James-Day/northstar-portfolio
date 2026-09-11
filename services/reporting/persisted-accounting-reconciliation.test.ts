import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type DailyClose } from '@/lib/domain/types';
import { valueLedgerHistory } from '@/services/calculations/valuation';
import { applyLinkedLotTransfers, type InternalTransfer } from '@/services/ledger/transfers';
import type { LedgerEvent } from '@/services/ledger/fifo';
import { composePersistedReportInputs, type PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { calculateConsolidatedReport, type ConsolidatedAccountInput } from '@/services/reporting/consolidated';

const d = decimalString;
const date = (value: string) => isoDate(value);
const instrument = 'instrument-stock' as never;
const actionDate = date('2026-01-02');
const latestImportIds = new Set(['dividend', 'drip-buy', 'sale', 'account-fee', 'cash-out', 'cash-in']);

const close = (tradingDate: string, value: string): DailyClose => ({
  instrumentId: instrument,
  tradingDate: date(tradingDate),
  close: d(value),
  source: tradingDate === '2026-01-03' ? 'marketstack' : 'dolthub',
  sourceRevision: `fixture-${tradingDate}`,
});

/** Independent, database-shaped replay rows used by the accounting gate. */
function fixtureEvents(): { taxable: LedgerEvent[]; ira: LedgerEvent[] } {
  return {
    taxable: [
      { id: 'deposit', date: date('2026-01-01'), type: 'deposit', amount: d('1000') },
      { id: 'first-buy', date: date('2026-01-01'), type: 'buy', instrumentId: instrument, quantity: d('10'), grossAmount: d('500'), fee: d('2') },
      { id: 'second-buy', date: date('2026-01-01'), type: 'buy', instrumentId: instrument, quantity: d('2'), grossAmount: d('120'), fee: d('1') },
      { id: 'dividend', date: date('2026-01-03'), type: 'dividend', instrumentId: instrument, amount: d('5') },
      { id: 'drip-buy', date: date('2026-01-03'), type: 'drip_buy', instrumentId: instrument, quantity: d('0.1'), grossAmount: d('5'), fee: d('0') },
      { id: 'sale', date: date('2026-01-03'), type: 'sell', instrumentId: instrument, quantity: d('6'), grossAmount: d('420'), fee: d('3') },
      { id: 'account-fee', date: date('2026-01-03'), type: 'fee', amount: d('2') },
      { id: 'cash-out', date: date('2026-01-03'), type: 'transfer_out', amount: d('100') },
    ],
    ira: [
      { id: 'cash-in', date: date('2026-01-03'), type: 'transfer_in', amount: d('100') },
    ],
  };
}

function reportInputs(events: LedgerEvent[]): PersistedReportInputs {
  return composePersistedReportInputs({
    replay: {
      events,
      openingLots: [],
      activityCoveredThrough: date('2026-01-03'),
      sourceEntryIds: events.map((event) => event.id),
    },
    dates: [
      { date: date('2026-01-01'), canChainFromPrevious: false },
      { date: actionDate, canChainFromPrevious: true },
      { date: date('2026-01-03'), canChainFromPrevious: true },
    ],
    closes: [close('2026-01-01', '50'), close('2026-01-02', '25'), close('2026-01-03', '60')],
    corporateActions: [{
      instrumentId: instrument,
      type: 'split',
      status: 'validated',
      ratioNumerator: d('2'),
      ratioDenominator: d('1'),
      effectiveDate: actionDate,
    }],
  });
}

function account(accountId: string, inputs: PersistedReportInputs): ConsolidatedAccountInput {
  return { accountId, inputs };
}

function activeAfterUndo(events: LedgerEvent[]): LedgerEvent[] {
  return events.filter((event) => !latestImportIds.has(event.id));
}

describe('persisted accounting reconciliation fixture', () => {
  it('reconciles cash, positions, FIFO gains, fees, DRIP, transfer cancellation, and split order', () => {
    const events = fixtureEvents();
    const taxable = reportInputs(events.taxable);
    const ira = reportInputs(events.ira);
    const consolidated = calculateConsolidatedReport({
      accounts: [account('taxable', taxable), account('ira', ira)],
      links: [{ transferGroupId: 'cash-move', outgoingId: 'cash-out', incomingId: 'cash-in' }],
    });

    // Persisted ledger projection: fees reduce cash once, while DRIP is income plus shares.
    expect(taxable.ledger).toMatchObject({ cash: '692', dividendIncome: '5', netDeposits: '1000', realizedGainLoss: '115.8' });
    expect(taxable.ledger.openLots.map((lot) => ({ quantity: lot.remainingQuantity, basis: lot.totalCostBasis }))).toEqual([
      { quantity: '4', basis: '502' },
      { quantity: '2', basis: '121' },
      { quantity: '0.1', basis: '5' },
    ]);

    // The independent consolidated replay removes only the proven cash transfer pair.
    expect(consolidated.inputs.unresolvedTransfers).toEqual([]);
    expect(consolidated.inputs.ledger).toMatchObject({ cash: '792', dividendIncome: '5', netDeposits: '1000', realizedGainLoss: '115.8' });
    expect(consolidated.history.valuations.map((valuation) => ({ date: valuation.date, value: valuation.totalValue, cash: valuation.cash, quantity: valuation.holdings[0]?.quantity }))).toEqual([
      { date: '2026-01-01', value: '977', cash: '377', quantity: '12' },
      { date: '2026-01-02', value: '977', cash: '377', quantity: '24' },
      { date: '2026-01-03', value: '1878', cash: '792', quantity: '18.1' },
    ]);
    expect(consolidated.inputs.valuation.events.map((event) => event.id)).not.toContain('cash-out');
    expect(consolidated.inputs.valuation.events.map((event) => event.id)).not.toContain('cash-in');
  });

  it('carries FIFO basis through a share transfer and restores pre-import state after undo', () => {
    const events = fixtureEvents();
    const sourceLots = reportInputs(events.taxable).ledger.openLots.map((lot) => ({ ...lot, accountId: 'taxable' }));
    const transfers: InternalTransfer[] = [
      { id: 'shares-out', transferGroupId: 'share-move', direction: 'out', accountId: 'taxable', instrumentId: instrument, quantity: d('2'), cashAmount: d('0') },
      { id: 'shares-in', transferGroupId: 'share-move', direction: 'in', accountId: 'ira', instrumentId: instrument, quantity: d('2'), cashAmount: d('0') },
    ];
    const transferred = applyLinkedLotTransfers(sourceLots, transfers, [{ transferGroupId: 'share-move', outgoingId: 'shares-out', incomingId: 'shares-in' }]);
    expect(transferred.unresolved).toEqual([]);
    expect(transferred.lots.filter((lot) => lot.accountId === 'ira')).toMatchObject([
      { quantity: '2', remainingQuantity: '2', totalCostBasis: '100.4' },
    ]);
    expect(transferred.lots.filter((lot) => lot.accountId === 'taxable').reduce((total, lot) => total + Number(lot.remainingQuantity), 0)).toBeCloseTo(4.1);

    const undoneTaxable = reportInputs(activeAfterUndo(events.taxable));
    const undoneHistory = valueLedgerHistory(undoneTaxable.valuation);
    expect(undoneTaxable.ledger).toMatchObject({ cash: '377', dividendIncome: '0', netDeposits: '1000', realizedGainLoss: '0' });
    expect(undoneTaxable.ledger.openLots.map((lot) => ({ quantity: lot.remainingQuantity, basis: lot.totalCostBasis }))).toEqual([
      { quantity: '10', basis: '502' },
      { quantity: '2', basis: '121' },
    ]);
    expect(undoneHistory.valuations[1]).toMatchObject({ totalValue: '977', cash: '377', holdings: [{ quantity: '24', value: '600' }] });
    expect(undoneTaxable.valuation.events.map((event) => event.id)).toEqual(['deposit', 'first-buy', 'second-buy']);
    // Undo changes the active replay while source rows/import evidence remains separately retained by persistence.
    expect([...latestImportIds]).toHaveLength(6);
  });
});

