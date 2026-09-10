import type { InstrumentId, IsoDate } from '@/lib/domain/types';
import type { DoltHubDailyClose, DoltHubCloseCursor } from '@/services/market-data/dolthub';
import { prepareHistoricalPriceIngestion, type HistoricalContinuityIssue, type HistoricalPagePersistence, type HistoricalPageSource, type HistoricalPriceUpsert } from '@/services/market-data/historical-ingestion';

export type HistoricalSeedStatus = 'running' | 'completed' | 'failed';

export type HistoricalSeedJobState = {
  id: string;
  source: 'dolthub';
  symbols: string[];
  from: IsoDate;
  through: IsoDate;
  pageLimit: number;
  sourceRevision: string | null;
  cursor: DoltHubCloseCursor | null;
  status: HistoricalSeedStatus;
  pages: number;
  acceptedRows: number;
  quarantinedRows: number;
  lastError: string | null;
};

export type HistoricalSeedMapping = {
  jobId: string;
  sourceRevision: string;
  symbol: string;
  tradingDate: IsoDate;
  instrumentId: InstrumentId;
};

export type HistoricalSeedQuarantine = {
  jobId: string;
  sourceRevision: string;
  record: DoltHubDailyClose;
  reason: string;
  status: 'pending' | 'validated' | 'rejected';
};

/** Durable state needed to restart a seed without losing its source boundary. */
export type HistoricalSeedJobRepository = {
  getOrCreate(input: { symbols: string[]; from: IsoDate; through: IsoDate; pageLimit: number }): Promise<HistoricalSeedJobState>;
  recordPage(input: {
    jobId: string;
    sourceRevision: string;
    cursor: DoltHubCloseCursor | null;
    accepted: HistoricalPriceUpsert[];
    mappings: HistoricalSeedMapping[];
    quarantined: HistoricalSeedQuarantine[];
    continuityIssues: HistoricalContinuityIssue[];
    upserted: number;
  }): Promise<void>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
};

export type HistoricalSeedRunResult = {
  jobId: string;
  status: HistoricalSeedStatus;
  sourceRevision: string | null;
  pages: number;
  upserted: number;
  quarantined: number;
  continuityIssues: HistoricalContinuityIssue[];
};

/**
 * Runs a bounded DoltHub seed one page at a time. The repository records the
 * cursor only after prices and review records have been persisted, so a crash
 * can safely replay a page (all writes are idempotent) and never skip data.
 */
export async function runHistoricalSeedJob(input: {
  source: HistoricalPageSource;
  persistence: HistoricalPagePersistence;
  jobs: HistoricalSeedJobRepository;
  aliases: import('@/lib/domain/types').InstrumentAlias[];
  symbols: string[];
  from: IsoDate;
  through: IsoDate;
  pageLimit?: number;
}): Promise<HistoricalSeedRunResult> {
  const pageLimit = input.pageLimit ?? 1_000;
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 5_000) throw new Error('Historical seed page limit must be an integer from 1 to 5000.');
  const state = await input.jobs.getOrCreate({ symbols: input.symbols, from: input.from, through: input.through, pageLimit });
  if (state.status === 'completed') return { jobId: state.id, status: state.status, sourceRevision: state.sourceRevision, pages: state.pages, upserted: 0, quarantined: state.quarantinedRows, continuityIssues: [] };

  let cursor = state.cursor ?? undefined;
  let sourceRevision = state.sourceRevision ?? undefined;
  const continuityIssues: HistoricalContinuityIssue[] = [];
  let upserted = 0;
  let quarantined = 0;
  let pages = state.pages;
  try {
    while (true) {
      const page = await input.source.getDailyClosePage({ symbols: state.symbols, from: state.from, through: state.through, limit: state.pageLimit, cursor });
      if (sourceRevision && sourceRevision !== page.sourceRevision) throw new Error('DoltHub source revision changed while resuming the seed; retry with a new job.');
      sourceRevision ??= page.sourceRevision;
      const revision = sourceRevision as string;
      const prepared = prepareHistoricalPriceIngestion(page.records, input.aliases, revision);
      const persisted = await input.persistence.persistDoltHubPage({ sourceRevision: revision, records: prepared.accepted });
      const pageQuarantine = prepared.quarantined.map((item) => ({ jobId: state.id, sourceRevision: revision, record: item.record, reason: item.reason, status: 'pending' as const }));
      const mappings = prepared.accepted.filter((record) => record.sourceSymbol).map((record) => ({ jobId: state.id, sourceRevision: revision, symbol: record.sourceSymbol as string, tradingDate: record.tradingDate, instrumentId: record.instrumentId }));
      // The cursor is advanced only after the whole page is durably accounted for.
      await input.jobs.recordPage({ jobId: state.id, sourceRevision: revision, cursor: page.nextCursor, accepted: prepared.accepted, mappings, quarantined: pageQuarantine, continuityIssues: prepared.continuityIssues, upserted: persisted.upserted });
      upserted += persisted.upserted;
      quarantined += pageQuarantine.length;
      pages += 1;
      continuityIssues.push(...prepared.continuityIssues);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) {
        await input.jobs.complete(state.id);
        return { jobId: state.id, status: 'completed', sourceRevision, pages, upserted, quarantined, continuityIssues };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Historical seed failed.';
    await input.jobs.fail(state.id, message);
    throw error;
  }
}
