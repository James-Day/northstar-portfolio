import type { InstrumentAlias, InstrumentId, IsoDate } from '@/lib/domain/types';
import { resolveInstrumentAlias } from '@/services/instruments/resolver';
import { inspectPriceRecords } from '@/services/market-data/quality';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';
import { isUsEquityTradingDay } from '@/services/market-data/us-equity-calendar';

export type HistoricalPriceUpsert = {
  instrumentId: InstrumentId;
  /** Original source ticker retained for mapping and operator evidence. */
  sourceSymbol?: string;
  tradingDate: IsoDate;
  close: DoltHubDailyClose['close'];
  source: 'dolthub';
  sourceRevision: string;
};

export type HistoricalPriceIngestion = {
  source: 'dolthub';
  sourceRevision: string;
  accepted: HistoricalPriceUpsert[];
  quarantined: Array<{ record: DoltHubDailyClose; reason: string }>;
  continuityIssues: HistoricalContinuityIssue[];
};

export type HistoricalContinuityIssue = {
  symbol: string;
  kind: 'missing_trading_dates' | 'alias_gap';
  dates: IsoDate[];
};

export type HistoricalGapBackfillRequest = {
  symbol: string;
  from: IsoDate;
  through: IsoDate;
  reason: 'missing_trading_dates' | 'alias_gap';
};

export type HistoricalPageSource = {
  getDailyClosePage(input: { symbols: string[]; from: IsoDate; through: IsoDate; limit?: number; cursor?: { tradingDate: IsoDate; symbol: string } }): Promise<{ records: DoltHubDailyClose[]; sourceRevision: string; nextCursor: { tradingDate: IsoDate; symbol: string } | null }>;
};

export type HistoricalPagePersistence = {
  persistDoltHubPage(input: { sourceRevision: string; records: HistoricalPriceUpsert[] }): Promise<{ revisionId: string; upserted: number }>;
};

/** Reads and persists every bounded page while keeping one immutable source revision. */
export async function ingestDoltHubHistory(input: {
  source: HistoricalPageSource;
  persistence: HistoricalPagePersistence;
  symbols: string[];
  from: IsoDate;
  through: IsoDate;
  aliases: InstrumentAlias[];
  limit?: number;
}): Promise<{ sourceRevision: string; pages: number; upserted: number; quarantined: HistoricalPriceIngestion['quarantined']; continuityIssues: HistoricalContinuityIssue[] }> {
  let cursor: { tradingDate: IsoDate; symbol: string } | undefined;
  let sourceRevision: string | undefined;
  let pages = 0;
  let upserted = 0;
  const quarantined: HistoricalPriceIngestion['quarantined'] = [];
  const continuityIssues: HistoricalContinuityIssue[] = [];
  do {
    const page = await input.source.getDailyClosePage({ symbols: input.symbols, from: input.from, through: input.through, limit: input.limit, cursor });
    if (!sourceRevision) sourceRevision = page.sourceRevision;
    if (sourceRevision !== page.sourceRevision) throw new Error('DoltHub source revision changed between historical pages; retry the ingestion.');
    const prepared = prepareHistoricalPriceIngestion(page.records, input.aliases, sourceRevision);
    quarantined.push(...prepared.quarantined);
    continuityIssues.push(...prepared.continuityIssues);
    upserted += (await input.persistence.persistDoltHubPage({ sourceRevision, records: prepared.accepted })).upserted;
    pages += 1;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { sourceRevision: sourceRevision ?? '', pages, upserted, quarantined, continuityIssues };
}

/** Finds calendar gaps and dates that cannot be resolved through an effective alias. */
export function inspectHistoricalContinuity(records: DoltHubDailyClose[], aliases: InstrumentAlias[]): HistoricalContinuityIssue[] {
  const issues: HistoricalContinuityIssue[] = [];
  const bySymbol = new Map<string, DoltHubDailyClose[]>();
  for (const record of records) {
    const symbol = record.symbol.trim().toUpperCase();
    const list = bySymbol.get(symbol) ?? [];
    list.push(record);
    bySymbol.set(symbol, list);
    try {
      if (!resolveInstrumentAlias(aliases, symbol, record.tradingDate)) issues.push({ symbol, kind: 'alias_gap', dates: [record.tradingDate] });
    } catch {
      issues.push({ symbol, kind: 'alias_gap', dates: [record.tradingDate] });
    }
  }
  for (const [symbol, symbolRecords] of bySymbol) {
    const dates = new Set(symbolRecords.map((record) => record.tradingDate));
    const ordered = [...dates].sort();
    if (ordered.length < 2) continue;
    const missing: IsoDate[] = [];
    const cursor = new Date(`${ordered[0]}T00:00:00.000Z`);
    const end = new Date(`${ordered.at(-1)}T00:00:00.000Z`);
    while (cursor < end) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const date = cursor.toISOString().slice(0, 10) as IsoDate;
      if (cursor < end && isUsEquityTradingDay(date) && !dates.has(date)) missing.push(date);
    }
    if (missing.length) issues.push({ symbol, kind: 'missing_trading_dates', dates: missing });
  }
  return issues;
}

/**
 * Converts continuity findings into deterministic, bounded backfill work. The
 * planner never invents prices; it only asks the source for the exact dates
 * that need another lookup, allowing a later job to quarantine unresolved
 * aliases or unavailable source data.
 */
export function planHistoricalGapBackfills(issues: HistoricalContinuityIssue[], maxDatesPerRequest = 30): HistoricalGapBackfillRequest[] {
  if (!Number.isInteger(maxDatesPerRequest) || maxDatesPerRequest < 1 || maxDatesPerRequest > 365)
    throw new Error('Historical backfill batch size must be an integer from 1 through 365.');
  const requests: HistoricalGapBackfillRequest[] = [];
  for (const issue of issues) {
    const dates = [...new Set(issue.dates)].sort();
    for (let index = 0; index < dates.length; index += maxDatesPerRequest) {
      const batch = dates.slice(index, index + maxDatesPerRequest);
      if (batch.length) requests.push({ symbol: issue.symbol.trim().toUpperCase(), from: batch[0], through: batch.at(-1)!, reason: issue.kind });
    }
  }
  return requests.sort((left, right) => left.symbol.localeCompare(right.symbol) || left.from.localeCompare(right.from) || left.reason.localeCompare(right.reason));
}

/**
 * Converts a stable DoltHub page into database-ready rows. Alias resolution is
 * date-aware and fail-closed: an unknown or ambiguous ticker is quarantined,
 * never assigned a guessed instrument. Quality checks run before mapping so a
 * suspicious close cannot become authoritative through a valid alias.
 */
export function prepareHistoricalPriceIngestion(
  records: DoltHubDailyClose[],
  aliases: InstrumentAlias[],
  sourceRevision: string,
): HistoricalPriceIngestion {
  if (!sourceRevision.trim()) throw new Error('A DoltHub source revision is required.');
  const quality = inspectPriceRecords(records.map((record) => ({ instrumentId: record.symbol, tradingDate: record.tradingDate, close: record.close })));
  const rejected = new Map(quality.quarantined.map((item) => [`${item.instrumentId}|${item.tradingDate}`, item.issues.map((issue) => issue.detail).join(' ')]));
  const accepted: HistoricalPriceUpsert[] = [];
  const quarantined: HistoricalPriceIngestion['quarantined'] = [];
  for (const record of records) {
    const qualityReason = rejected.get(`${record.symbol}|${record.tradingDate}`);
    if (qualityReason) {
      quarantined.push({ record, reason: qualityReason });
      continue;
    }
    try {
      const instrumentId = resolveInstrumentAlias(aliases, record.symbol, record.tradingDate);
      if (!instrumentId) throw new Error(`No effective instrument alias for ${record.symbol} on ${record.tradingDate}.`);
      accepted.push({ instrumentId, sourceSymbol: record.symbol, tradingDate: record.tradingDate, close: record.close, source: 'dolthub', sourceRevision });
    } catch (error) {
      quarantined.push({ record, reason: error instanceof Error ? error.message : 'Instrument alias resolution failed.' });
    }
  }
  return { source: 'dolthub', sourceRevision, accepted: deduplicateAccepted(accepted), quarantined, continuityIssues: inspectHistoricalContinuity(records, aliases) };
}

function deduplicateAccepted(rows: HistoricalPriceUpsert[]): HistoricalPriceUpsert[] {
  const byKey = new Map<string, HistoricalPriceUpsert>();
  for (const row of rows) byKey.set(`${row.instrumentId}|${row.tradingDate}|${row.sourceRevision}`, row);
  return [...byKey.values()].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate) || left.instrumentId.localeCompare(right.instrumentId));
}
