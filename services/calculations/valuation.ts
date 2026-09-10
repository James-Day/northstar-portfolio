import Decimal from "decimal.js";
import { decimalString, type DecimalString } from "@/lib/domain/money";
import type { DailyClose, IsoDate, InstrumentId } from "@/lib/domain/types";
import { applyFifoLedger, type LedgerEvent } from "@/services/ledger/fifo";
import {
  applyValidatedCorporateAction,
  type CorporateAction,
} from "@/services/ledger/corporate-actions";
import {
  calculateModifiedDietz,
  chainTimeWeightedReturn,
  type ModifiedDietzResult,
} from "@/services/calculations/returns";

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
const asString = (value: Decimal.Value) =>
  decimalString(new Decimal(value).toFixed());

/**
 * Values the exact shares and cash produced by the normalized ledger. Prices
 * are never carried forward: a missing close makes that date unavailable.
 */
export function valueLedgerHistory(input: {
  dates: ValuationDate[];
  events: LedgerEvent[];
  openingLots?: import("@/services/ledger/fifo").LotInput[];
  closes: DailyClose[];
  corporateActions?: Array<CorporateAction & { effectiveDate: IsoDate }>;
}): ValuationHistory {
  assertStrictDates(input.dates);
  assertEventOrder(input.events);
  const closeIndex = indexCloses(input.closes);
  const valuations: DailyValuation[] = [];
  for (const valuationDate of input.dates) {
    const ledger = replayLedgerWithActions(
      input.events.filter((event) => event.date <= valuationDate.date),
      input.openingLots ?? [],
      (input.corporateActions ?? []).filter(
        (action) => action.effectiveDate <= valuationDate.date,
      ),
    );
    let lots = ledger.openLots;
    const quantities = new Map<string, Decimal>();
    for (const lot of lots) {
      quantities.set(
        lot.instrumentId,
        (quantities.get(lot.instrumentId) ?? new Decimal(0)).plus(
          lot.remainingQuantity,
        ),
      );
    }
    const prices =
      closeIndex.get(valuationDate.date) ?? new Map<string, DecimalString>();
    const holdings: ValuationHolding[] = [];
    const missingInstrumentIds: string[] = [];
    let holdingsValue = new Decimal(0);
    for (const [instrumentId, quantity] of [...quantities.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const close = prices.get(instrumentId) ?? null;
      if (close === null) {
        missingInstrumentIds.push(instrumentId);
        holdings.push({
          instrumentId,
          quantity: asString(quantity),
          close: null,
          value: null,
        });
      } else {
        const value = quantity.times(close);
        holdingsValue = holdingsValue.plus(value);
        holdings.push({
          instrumentId,
          quantity: asString(quantity),
          close,
          value: asString(value),
        });
      }
    }
    const cash = ledger.cash;
    const totalValue =
      missingInstrumentIds.length === 0
        ? asString(holdingsValue.plus(cash))
        : null;
    const { externalFlows, excludedIncentives } = flowsForDate(
      input.events,
      valuationDate.date,
    );
    const previous = valuations.at(-1);
    const result = previous
      ? calculateModifiedDietz({
          startingValue: previous.totalValue ?? decimalString("0"),
          endingValue: totalValue ?? decimalString("0"),
          externalFlows,
          excludedIncentives,
          hasCompleteValuation:
            previous.totalValue !== null && totalValue !== null,
        })
      : {
          return: null,
          investmentGain: null,
          unavailableReason: "missing_valuation" as const,
        };
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
    timeWeightedReturn: chainTimeWeightedReturn(
      valuations
        .slice(1)
        .map((valuation) => ({
          result: valuation.return,
          canChainFromPrevious: valuation.canChainFromPrevious,
        })),
    ),
  };
}

/** Replays events and effective corporate actions in chronological order. Actions
 * are applied before trades on their effective date, so post-split purchases
 * retain their post-action quantity and basis. */
function replayLedgerWithActions(
  events: LedgerEvent[],
  openingLots: import("@/services/ledger/fifo").LotInput[],
  actions: Array<CorporateAction & { effectiveDate: IsoDate }>,
) {
  const orderedActions = [...actions].sort((left, right) =>
    left.effectiveDate.localeCompare(right.effectiveDate),
  );
  let lots = applyFifoLedger([], openingLots).openLots;
  let cash = new Decimal(0);
  let dividendIncome = new Decimal(0);
  let netDeposits = new Decimal(0);
  let realizedGainLoss = new Decimal(0);
  let hasUnknownBasis = false;
  const sales: ReturnType<typeof applyFifoLedger>["sales"] = [];
  let cursor = 0;
  for (const action of orderedActions) {
    const beforeAction = events.filter(
      (event) =>
        event.date < action.effectiveDate &&
        event.date >=
          (cursor === 0
            ? ("" as IsoDate)
            : orderedActions[cursor - 1].effectiveDate),
    );
    if (beforeAction.length) {
      const segment = applyFifoLedger(beforeAction, asOpeningLots(lots));
      cash = cash.plus(segment.cash);
      dividendIncome = dividendIncome.plus(segment.dividendIncome);
      netDeposits = netDeposits.plus(segment.netDeposits);
      if (segment.realizedGainLoss === null) hasUnknownBasis = true;
      else realizedGainLoss = realizedGainLoss.plus(segment.realizedGainLoss);
      sales.push(...segment.sales);
      lots = segment.openLots;
    }
    lots = applyValidatedCorporateAction(
      lots.map((lot) => ({ ...lot })),
      action,
    );
    cursor += 1;
  }
  const remaining = events.filter(
    (event) =>
      cursor === 0 || event.date >= orderedActions[cursor - 1].effectiveDate,
  );
  if (remaining.length) {
    const segment = applyFifoLedger(remaining, asOpeningLots(lots));
    cash = cash.plus(segment.cash);
    dividendIncome = dividendIncome.plus(segment.dividendIncome);
    netDeposits = netDeposits.plus(segment.netDeposits);
    if (segment.realizedGainLoss === null) hasUnknownBasis = true;
    else realizedGainLoss = realizedGainLoss.plus(segment.realizedGainLoss);
    sales.push(...segment.sales);
    lots = segment.openLots;
  }
  return {
    cash: asString(cash),
    dividendIncome: asString(dividendIncome),
    netDeposits: asString(netDeposits),
    realizedGainLoss: hasUnknownBasis ? null : asString(realizedGainLoss),
    sales,
    openLots: lots,
  };
}

function asOpeningLots(
  lots: import("@/services/ledger/fifo").OpenLot[],
): import("@/services/ledger/fifo").LotInput[] {
  return lots.map((lot) => {
    const remaining = new Decimal(lot.remainingQuantity);
    const original = new Decimal(lot.quantity);
    const basis =
      lot.totalCostBasis === null
        ? null
        : asString(
            new Decimal(lot.totalCostBasis).times(remaining).div(original),
          );
    return {
      id: lot.id,
      instrumentId: lot.instrumentId,
      acquiredOn: lot.acquiredOn,
      quantity: asString(remaining),
      totalCostBasis: basis,
    };
  });
}

function flowsForDate(events: LedgerEvent[], date: IsoDate) {
  let externalFlows = new Decimal(0);
  let excludedIncentives = new Decimal(0);
  for (const event of events) {
    if (event.date !== date) continue;
    if (event.type === "deposit")
      externalFlows = externalFlows.plus(event.amount);
    if (event.type === "withdrawal")
      externalFlows = externalFlows.minus(event.amount);
    if (event.type === "ira_incentive")
      excludedIncentives = excludedIncentives.plus(event.amount);
  }
  return {
    externalFlows: asString(externalFlows),
    excludedIncentives: asString(excludedIncentives),
  };
}

function indexCloses(closes: DailyClose[]) {
  const index = new Map<IsoDate, Map<string, DecimalString>>();
  for (const close of closes) {
    if (asDecimal(close.close).lte(0))
      throw new Error(
        `Close for ${close.instrumentId} on ${close.tradingDate} must be greater than zero.`,
      );
    const byInstrument =
      index.get(close.tradingDate) ?? new Map<string, DecimalString>();
    if (byInstrument.has(close.instrumentId))
      throw new Error(
        `Duplicate close for ${close.instrumentId} on ${close.tradingDate}.`,
      );
    byInstrument.set(close.instrumentId, close.close);
    index.set(close.tradingDate, byInstrument);
  }
  return index;
}

function assertStrictDates(dates: ValuationDate[]) {
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index - 1].date >= dates[index].date)
      throw new Error("Valuation dates must be strictly ascending.");
  }
}

function assertEventOrder(events: LedgerEvent[]) {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index - 1].date > events[index].date)
      throw new Error("Ledger events must be ordered by date.");
  }
}
