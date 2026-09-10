import type { DailyClose, IsoDate } from '@/lib/domain/types';
import { applyFifoLedger, type LedgerResult } from '@/services/ledger/fifo';
import type { PersistedLedgerReplay } from '@/services/ledger/persisted-replay';
import type { CorporateAction } from '@/services/ledger/corporate-actions';
import type { ValuationDate } from '@/services/calculations/valuation';
import { selectAuthoritativePrices, type PriceCorrection, type PriceDependency } from '@/services/market-data/price-corrections';

/** The calculation inputs a report worker must pass to valuation and snapshot building. */
export type PersistedReportInputs = {
  valuation: {
    dates: ValuationDate[];
    events: PersistedLedgerReplay['events'];
    openingLots: PersistedLedgerReplay['openingLots'];
    closes: DailyClose[];
    corporateActions: Array<CorporateAction & { effectiveDate: IsoDate }>;
  };
  ledger: LedgerResult;
  activityCoveredThrough: IsoDate | null;
  pricesThrough: IsoDate | null;
  /** Every selected source/correction dependency used by this report. */
  priceDependencies?: PriceDependency[];
  /** Stable over retries for the same committed source rows. */
  importStateRevision: string;
};

/**
 * Composes persisted account state into one deterministic report-job input.
 *
 * The market calendar is deliberately supplied by the caller: valuation must
 * never infer weekends or holidays. Stored closes are narrowed to the selected
 * dates and instruments so a worker cannot accidentally value an account with
 * another account's prices. Corporate actions are passed through unchanged;
 * valuation enforces that only validated actions can mutate lots.
 */
export function composePersistedReportInputs(input: {
  replay: PersistedLedgerReplay;
  dates: ValuationDate[];
  closes: DailyClose[];
  corrections?: PriceCorrection[];
  corporateActions?: Array<CorporateAction & { effectiveDate: IsoDate }>;
}): PersistedReportInputs {
  const dates = [...input.dates];
  const dateSet = new Set(dates.map((date) => date.date));
  const instrumentSet = new Set<string>([
    ...input.replay.openingLots.map((lot) => lot.instrumentId),
    ...input.replay.events.flatMap((event) => 'instrumentId' in event ? [event.instrumentId] : []),
  ]);
  const narrowedCloses = input.closes
    .filter((close) => dateSet.has(close.tradingDate) && instrumentSet.has(close.instrumentId))
  const selection = selectAuthoritativePrices(narrowedCloses, input.corrections);
  const closes = selection.closes.sort((left, right) => left.tradingDate.localeCompare(right.tradingDate) || left.instrumentId.localeCompare(right.instrumentId));
  const ledger = applyFifoLedger(input.replay.events, input.replay.openingLots);
  const pricesThrough = closes.length ? closes.reduce((latest, close) => close.tradingDate > latest ? close.tradingDate : latest, closes[0].tradingDate) : null;

  return {
    valuation: {
      dates,
      events: input.replay.events,
      openingLots: input.replay.openingLots,
      closes,
      corporateActions: [...(input.corporateActions ?? [])].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate) || left.instrumentId.localeCompare(right.instrumentId)),
    },
    ledger,
    activityCoveredThrough: input.replay.activityCoveredThrough,
    pricesThrough,
    priceDependencies: selection.dependencies,
    importStateRevision: revisionFor(input.replay.sourceEntryIds),
  };
}

function revisionFor(sourceEntryIds: string[]) {
  const ids = [...new Set(sourceEntryIds)].sort();
  return `ledger:${ids.join(',') || 'empty'}`;
}
