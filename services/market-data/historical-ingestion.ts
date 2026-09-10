import type { InstrumentAlias, InstrumentId, IsoDate } from '@/lib/domain/types';
import { resolveInstrumentAlias } from '@/services/instruments/resolver';
import { inspectPriceRecords } from '@/services/market-data/quality';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';

export type HistoricalPriceUpsert = {
  instrumentId: InstrumentId;
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
};

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
      accepted.push({ instrumentId, tradingDate: record.tradingDate, close: record.close, source: 'dolthub', sourceRevision });
    } catch (error) {
      quarantined.push({ record, reason: error instanceof Error ? error.message : 'Instrument alias resolution failed.' });
    }
  }
  return { source: 'dolthub', sourceRevision, accepted: deduplicateAccepted(accepted), quarantined };
}

function deduplicateAccepted(rows: HistoricalPriceUpsert[]): HistoricalPriceUpsert[] {
  const byKey = new Map<string, HistoricalPriceUpsert>();
  for (const row of rows) byKey.set(`${row.instrumentId}|${row.tradingDate}|${row.sourceRevision}`, row);
  return [...byKey.values()].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate) || left.instrumentId.localeCompare(right.instrumentId));
}
