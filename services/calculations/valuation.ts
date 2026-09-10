import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { DailyClose, IsoDate, InstrumentId } from '@/lib/domain/types';
import { applyFifoLedger, type LedgerEvent } from '@/services/ledger/fifo';
import { applyValidatedCorporateAction, type CorporateAction } from '@/services/ledger/corporate-actions';
import { calculateModifiedDietz, chainTimeWeightedReturn, type ModifiedDietzResult } from '@/services/calculations/returns';

export type ValuationDate = {
  date: IsoDate;
  /** Supplied by the market-calendar layer; weekends and market holidays are not guessed here. */
  canChainFromPrevious: boolean;
};

export type ValuationHolding = {
  instrumentId: string;
  quantity: DecimalString;
  close: DecimalString | null;
  value: DecimalString | null;
};

export type DailyValuation = {
  date: IsoDate;
  cash: DecimalString;
  holdings: ValuationHolding[];
  totalValue: DecimalString | null;
  missingInstrumentIds: string[];
  externalFlows: DecimalString;
  excludedIncentives: DecimalString;
  return: ModifiedDietzResult;
  canChainFromPrevious: boolean;
};

export type ValuationHistory = {
  valuations: DailyValuation[];
  timeWeightedReturn: DecimalString | null;
};

const asDecimal = (value: DecimalString) => new Decimal(value);
const asString = (value: Decimal.Value) => decimalString(new Decimal(value).toFixed());

/**
 * Values the exact shares and cash produced by the normalized ledger. Prices
 * are never carried forward: a missing close makes that date unavailable.
 */
export function valueLedgerHistory(input: {
  dates: ValuationDate[];
  events: LedgerEvent[];
  openingLots?: import('@/services/ledger/fifo').LotInput[];
  closes: DailyClose[];
  corporateActions?: Array<CorporateAction & { effectiveDate: IsoDate }>;
}): ValuationHistory {
  assertStrictDates(input.dates);
  assertEventOrder(input.events);
  const closeIndex = indexCloses(input.closes);
  const valuations: DailyValuation[] = [];
  for (const valuationDate of input.dates) {
    const ledger = applyFifoLedger(input.events.filter((event) => event.date <= valuationDate.date), input.openingLots ?? []);
    let lots = ledger.openLots;
    for (const action of [...(input.corporateActions ?? [])].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))) {
      if (action.effectiveDate <= valuationDate.date) lots = applyValidatedCorporateAction(lots, action);
    }
    const quantities = new Map<string, Decimal>();
    for (const lot of lots) {
      quantities.set(lot.instrumentId, (quantities.get(lot.instrumentId) ?? new Decimal(0)).plus(lot.remainingQuantity));
    }
    const prices = closeIndex.get(valuationDate.date) ?? new Map<string, DecimalString>();
    const holdings: ValuationHolding[] = [];
    const missingInstrumentIds: string[] = [];
    let holdingsValue = new Decimal(0);
    for (const [instrumentId, quantity] of [...quantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const close = prices.get(instrumentId) ?? null;
      if (close === null) {
        missingInstrumentIds.push(instrumentId);
        holdings.push({ instrumentId, quantity: asString(quantity), close: null, value: null });
      } else {
        const value = quantity.times(close);
        holdingsValue = holdingsValue.plus(value);
        holdings.push({ instrumentId, quantity: asString(quantity), close, value: asString(value) });
      }
    }
    const cash = ledger.cash;
    const totalValue = missingInstrumentIds.length === 0 ? asString(holdingsValue.plus(cash)) : null;
    const { externalFlows, excludedIncentives } = flowsForDate(input.events, valuationDate.date);
    const previous = valuations.at(-1);
    const result = previous
      ? calculateModifiedDietz({
        startingValue: previous.totalValue ?? decimalString('0'),
        endingValue: totalValue ?? decimalString('0'),
        externalFlows,
        excludedIncentives,
        hasCompleteValuation: previous.totalValue !== null && totalValue !== null,
      })
      : { return: null, investmentGain: null, unavailableReason: 'missing_valuation' as const };
    valuations.push({
      date: valuationDate.date,
      cash,
      holdings,
      totalValue,
      missingInstrumentIds,
      externalFlows,
      excludedIncentives,
      return: result,
      canChainFromPrevious: valuationDate.canChainFromPrevious,
    });
  }

  return {
    valuations,
    timeWeightedReturn: chainTimeWeightedReturn(valuations.slice(1).map((valuation) => ({ result: valuation.return, canChainFromPrevious: valuation.canChainFromPrevious }))),
  };
}

function flowsForDate(events: LedgerEvent[], date: IsoDate) {
  let externalFlows = new Decimal(0);
  let excludedIncentives = new Decimal(0);
  for (const event of events) {
    if (event.date !== date) continue;
    if (event.type === 'deposit') externalFlows = externalFlows.plus(event.amount);
    if (event.type === 'withdrawal') externalFlows = externalFlows.minus(event.amount);
    if (event.type === 'ira_incentive') excludedIncentives = excludedIncentives.plus(event.amount);
  }
  return { externalFlows: asString(externalFlows), excludedIncentives: asString(excludedIncentives) };
}

function indexCloses(closes: DailyClose[]) {
  const index = new Map<IsoDate, Map<string, DecimalString>>();
  for (const close of closes) {
    if (asDecimal(close.close).lte(0)) throw new Error(`Close for ${close.instrumentId} on ${close.tradingDate} must be greater than zero.`);
    const byInstrument = index.get(close.tradingDate) ?? new Map<string, DecimalString>();
    if (byInstrument.has(close.instrumentId)) throw new Error(`Duplicate close for ${close.instrumentId} on ${close.tradingDate}.`);
    byInstrument.set(close.instrumentId, close.close);
    index.set(close.tradingDate, byInstrument);
  }
  return index;
}

function assertStrictDates(dates: ValuationDate[]) {
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index - 1].date >= dates[index].date) throw new Error('Valuation dates must be strictly ascending.');
  }
}

function assertEventOrder(events: LedgerEvent[]) {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index - 1].date > events[index].date) throw new Error('Ledger events must be ordered by date.');
  }
}
