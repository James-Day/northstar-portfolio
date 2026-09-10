import type { InstrumentId, IsoDate } from '@/lib/domain/types';
import { classifyPriceFreshness, type PriceFreshness } from '@/services/market-data/stale-prices';

export type ReportInstrument = { instrumentId: InstrumentId; symbol: string };

/** Joins stored latest-close dates to report symbols without embedding storage concerns in the UI. */
export function buildPriceFreshnessReport(input: { instruments: ReportInstrument[]; expectedDate: IsoDate; latestByInstrument: Record<string, IsoDate | null> }): PriceFreshness[] {
  return classifyPriceFreshness({ symbols: input.instruments.map((instrument) => instrument.symbol), expectedDate: input.expectedDate, latestBySymbol: Object.fromEntries(input.instruments.map((instrument) => [instrument.symbol, input.latestByInstrument[instrument.instrumentId] ?? null])) });
}
