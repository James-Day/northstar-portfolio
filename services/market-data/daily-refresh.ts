import type { IsoDate } from '@/lib/domain/types';
import type { DailyPrice, DailyPriceProvider } from '@/services/market-data/types';
import { eligibleEodTradingDate } from '@/services/market-data/us-equity-calendar';
import { RefreshMetricsCollector } from '@/services/market-data/refresh-metrics';

export type DailyRefreshResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' }
  | { status: 'ready_to_persist'; tradingDate: IsoDate; requestedSymbols: string[]; prices: DailyPrice[] };

export type DailyPricePersistence = {
  persist(input: { tradingDate: IsoDate; prices: DailyPrice[] }): Promise<{ upserted: number }>;
};

export type DailyRefreshJobResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' }
  | { status: 'persisted'; tradingDate: IsoDate; requestedSymbols: string[]; upserted: number };

export type DailyRefreshRetryOptions = { maxAttempts?: number; baseDelayMs?: number; sleep?: (milliseconds: number) => Promise<void> };
export type DailyRefreshEvent =
  | { type: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' }
  | { type: 'attempt'; attempt: number; maxAttempts: number; symbolCount: number }
  | { type: 'failed'; attempt: number; maxAttempts: number; message: string }
  | { type: 'persisted'; tradingDate: IsoDate; symbolCount: number; upserted: number };
export type DailyRefreshTelemetry = { record: (event: DailyRefreshEvent) => void };
export type DailyRefreshRunRecorder = { record(run: { tradingDate: IsoDate | null; status: 'persisted' | 'skipped' | 'failed'; attempts: number; failedAttempts: number; requestedSymbols: number; persistedRows: number; quotaUnits: number; errorMessage?: string | null }): Promise<string> };

/**
 * Coordinates one shared EOD request for all active symbols. Persistence and
 * retry are separate infrastructure concerns, so a failed provider call is
 * deliberately surfaced to the job runner rather than hidden as stale data.
 */
export async function prepareDailyPriceRefresh(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
): Promise<DailyRefreshResult> {
  const tradingDate = eligibleEodTradingDate(now);
  if (!tradingDate) return { status: 'skipped', reason: 'before_close_or_non_trading_day' };

  const requestedSymbols = normalizeSymbols(activeSymbols);
  if (requestedSymbols.length === 0) return { status: 'skipped', reason: 'no_active_symbols' };

  const prices = await provider.getDailyPrices(requestedSymbols, tradingDate);
  validateProviderResponse(prices, requestedSymbols, tradingDate);
  return { status: 'ready_to_persist', tradingDate, requestedSymbols, prices };
}

/** Runs one guarded refresh and persists only a complete, validated provider response. */
export async function runDailyPriceRefresh(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
  persistence: DailyPricePersistence,
): Promise<DailyRefreshJobResult> {
  const prepared = await prepareDailyPriceRefresh(now, activeSymbols, provider);
  if (prepared.status === 'skipped') return prepared;
  const persisted = await persistence.persist({ tradingDate: prepared.tradingDate, prices: prepared.prices });
  return { status: 'persisted', tradingDate: prepared.tradingDate, requestedSymbols: prepared.requestedSymbols, upserted: persisted.upserted };
}

/** Retries a refresh with bounded exponential backoff; the final error remains visible to the job runner. */
export async function runDailyPriceRefreshWithRetry(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
  persistence: DailyPricePersistence,
  options: DailyRefreshRetryOptions = {},
  telemetry?: DailyRefreshTelemetry,
): Promise<DailyRefreshJobResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('Daily refresh attempts must be an integer from 1 through 5.');
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) throw new Error('Daily refresh backoff must be a non-negative integer.');
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    telemetry?.record({ type: 'attempt', attempt, maxAttempts, symbolCount: new Set(activeSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)).size });
    try {
      const result = await runDailyPriceRefresh(now, activeSymbols, provider, persistence);
      if (result.status === 'skipped') telemetry?.record({ type: 'skipped', reason: result.reason });
      else telemetry?.record({ type: 'persisted', tradingDate: result.tradingDate, symbolCount: result.requestedSymbols.length, upserted: result.upserted });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Daily refresh failed.';
      telemetry?.record({ type: 'failed', attempt, maxAttempts, message });
      if (attempt >= maxAttempts) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error('Daily refresh retry loop ended unexpectedly.');
}

/** Executes a refresh and records exactly one durable operational run outcome. */
export async function runAndRecordDailyPriceRefresh(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
  persistence: DailyPricePersistence,
  recorder: DailyRefreshRunRecorder,
  options: DailyRefreshRetryOptions = {},
): Promise<DailyRefreshJobResult> {
  const collector = new RefreshMetricsCollector();
  try {
    const result = await runDailyPriceRefreshWithRetry(now, activeSymbols, provider, persistence, options, collector);
    const metrics = collector.getSnapshot();
    await recorder.record({ tradingDate: result.status === 'persisted' ? result.tradingDate : null, status: result.status, attempts: metrics.attempts, failedAttempts: metrics.failedAttempts, requestedSymbols: metrics.requestedSymbols, persistedRows: result.status === 'persisted' ? result.upserted : 0, quotaUnits: metrics.requestedSymbols });
    return result;
  } catch (error) {
    const metrics = collector.getSnapshot();
    await recorder.record({ tradingDate: null, status: 'failed', attempts: metrics.attempts, failedAttempts: metrics.failedAttempts, requestedSymbols: metrics.requestedSymbols, persistedRows: 0, quotaUnits: metrics.requestedSymbols, errorMessage: error instanceof Error ? error.message : 'Daily refresh failed.' });
    throw error;
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
}

function validateProviderResponse(prices: DailyPrice[], requestedSymbols: string[], tradingDate: IsoDate) {
  const requested = new Set(requestedSymbols);
  const returned = new Set<string>();
  for (const price of prices) {
    if (price.tradingDate !== tradingDate) throw new Error(`Provider returned ${price.symbol} for ${price.tradingDate}, not requested date ${tradingDate}.`);
    if (!requested.has(price.symbol)) throw new Error(`Provider returned unrequested symbol ${price.symbol}.`);
    if (returned.has(price.symbol)) throw new Error(`Provider returned duplicate symbol ${price.symbol}.`);
    returned.add(price.symbol);
  }
  const missing = requestedSymbols.filter((symbol) => !returned.has(symbol));
  if (missing.length > 0) throw new Error(`Provider returned no daily close for: ${missing.join(', ')}.`);
}
