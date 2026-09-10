import type { IsoDate } from '@/lib/domain/types';
import type { DailyPrice, DailyPriceProvider } from '@/services/market-data/types';
import { eligibleEodTradingDate } from '@/services/market-data/us-equity-calendar';
import { RefreshMetricsCollector } from '@/services/market-data/refresh-metrics';
import type { MarketDataQuotaLedger, QuotaReservation } from '@/services/market-data/quota';

export type DailyRefreshResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' | 'already_fetched' | 'quota_exhausted' }
  | { status: 'ready_to_persist'; tradingDate: IsoDate; requestedSymbols: string[]; prices: DailyPrice[] };

export type DailyPricePersistence = {
  persist(input: { tradingDate: IsoDate; prices: DailyPrice[] }): Promise<{ upserted: number }>;
  getMissingSymbols?(symbols: string[], tradingDate: IsoDate): Promise<string[]>;
};

export type DailyRefreshJobResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' | 'already_fetched' | 'quota_exhausted' }
  | { status: 'persisted'; tradingDate: IsoDate; requestedSymbols: string[]; upserted: number };

export type DailyRefreshRetryOptions = { maxAttempts?: number; baseDelayMs?: number; sleep?: (milliseconds: number) => Promise<void> };
export type DailyRefreshEvent =
  | { type: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' | 'already_fetched' | 'quota_exhausted' }
  | { type: 'attempt'; attempt: number; maxAttempts: number; symbolCount: number }
  /** Emitted only immediately before a provider call, after all skip guards pass. */
  | { type: 'requested'; symbolCount: number }
  | { type: 'failed'; attempt: number; maxAttempts: number; message: string }
  | { type: 'persisted'; tradingDate: IsoDate; symbolCount: number; upserted: number };
export type DailyRefreshTelemetry = { record: (event: DailyRefreshEvent) => void };
export type DailyRefreshRunRecorder = { record(run: { tradingDate: IsoDate | null; status: 'persisted' | 'skipped' | 'failed'; attempts: number; failedAttempts: number; requestedSymbols: number; persistedRows: number; quotaUnits: number; errorMessage?: string | null }): Promise<string> };
/**
 * The legacy read-only guard is retained for local callers. Scheduled
 * production jobs should provide `ledger`, which atomically reserves capacity
 * before each provider attempt and reconciles it afterwards.
 */
export type DailyQuotaGuard = {
  monthlyCap: number;
  getUsedUnits?: (now: Date) => Promise<number>;
  ledger?: MarketDataQuotaLedger;
  idempotencyKeyPrefix?: string;
};

/** Optional durable cache lookup used to avoid re-requesting a completed EOD close. */
export type DailyPriceCache = { getMissingSymbols(symbols: string[], tradingDate: IsoDate): Promise<string[]> };

/**
 * Coordinates one shared EOD request for all active symbols. Persistence and
 * retry are separate infrastructure concerns, so a failed provider call is
 * deliberately surfaced to the job runner rather than hidden as stale data.
 */
export async function prepareDailyPriceRefresh(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
  quota?: DailyQuotaGuard,
  telemetry?: DailyRefreshTelemetry,
  reservationKey?: string,
): Promise<DailyRefreshResult> {
  const tradingDate = eligibleEodTradingDate(now);
  if (!tradingDate) return { status: 'skipped', reason: 'before_close_or_non_trading_day' };

  const requestedSymbols = normalizeSymbols(activeSymbols);
  if (requestedSymbols.length === 0) return { status: 'skipped', reason: 'no_active_symbols' };
  let reservation: QuotaReservation | undefined;
  if (quota?.ledger) {
    try {
      reservation = await quota.ledger.reserve({
        now,
        units: requestedSymbols.length,
        monthlyCap: quota.monthlyCap,
        idempotencyKey: reservationKey ?? makeReservationKey(now, tradingDate, requestedSymbols, quota.idempotencyKeyPrefix),
      });
    } catch (error) {
      if (isQuotaExhausted(error)) return { status: 'skipped', reason: 'quota_exhausted' };
      throw error;
    }
    if (reservation.units !== requestedSymbols.length) throw new Error('Quota ledger returned a reservation with an unexpected unit count.');
  } else if (quota?.getUsedUnits && await quota.getUsedUnits(now) + requestedSymbols.length > quota.monthlyCap) {
    return { status: 'skipped', reason: 'quota_exhausted' };
  }

  // This is the quota-bearing event. Skip paths and preflight failures must not
  // be included in the durable provider usage counter.
  telemetry?.record({ type: 'requested', symbolCount: requestedSymbols.length });
  let prices: DailyPrice[];
  try {
    prices = await provider.getDailyPrices(requestedSymbols, tradingDate);
  } catch (error) {
    await reconcileReservation(quota, reservation, requestedSymbols.length);
    throw error;
  }
  // A request that reached the provider consumes one unit per requested
  // symbol even when its response is malformed or incomplete.
  await reconcileReservation(quota, reservation, requestedSymbols.length);
  validateProviderResponse(prices, requestedSymbols, tradingDate);
  return { status: 'ready_to_persist', tradingDate, requestedSymbols, prices };
}

/** Runs one guarded refresh and persists only a complete, validated provider response. */
export async function runDailyPriceRefresh(
  now: Date,
  activeSymbols: string[],
  provider: DailyPriceProvider,
  persistence: DailyPricePersistence,
  quota?: DailyQuotaGuard,
  telemetry?: DailyRefreshTelemetry,
  reservationKey?: string,
): Promise<DailyRefreshJobResult> {
  const tradingDate = eligibleEodTradingDate(now);
  const requestedSymbols = normalizeSymbols(activeSymbols);
  const missingSymbols = tradingDate && 'getMissingSymbols' in persistence && typeof persistence.getMissingSymbols === 'function'
    ? await persistence.getMissingSymbols(requestedSymbols, tradingDate)
    : requestedSymbols;
  const prepared = await prepareDailyPriceRefresh(now, missingSymbols, provider, quota, telemetry, reservationKey);
  if (prepared.status === 'skipped' && prepared.reason === 'no_active_symbols' && requestedSymbols.length > 0 && missingSymbols.length === 0) {
    return { status: 'skipped', reason: 'already_fetched' };
  }
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
  quota?: DailyQuotaGuard,
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
      const result = await runDailyPriceRefresh(now, activeSymbols, provider, persistence, quota, telemetry, makeAttemptReservationKey(now, activeSymbols, attempt, quota));
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
  quota?: DailyQuotaGuard,
): Promise<DailyRefreshJobResult> {
  const collector = new RefreshMetricsCollector();
  try {
    const result = await runDailyPriceRefreshWithRetry(now, activeSymbols, provider, persistence, options, collector, quota);
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

function makeReservationKey(now: Date, tradingDate: IsoDate, symbols: string[], prefix = 'daily-refresh'): string {
  return `${prefix}:${now.toISOString()}:${tradingDate}:${normalizeSymbols(symbols).join(',')}`;
}

function makeAttemptReservationKey(now: Date, symbols: string[], attempt: number, quota?: DailyQuotaGuard): string {
  const tradingDate = eligibleEodTradingDate(now) ?? now.toISOString().slice(0, 10) as IsoDate;
  return `${quota?.idempotencyKeyPrefix ?? 'daily-refresh'}:${tradingDate}:attempt-${attempt}:${normalizeSymbols(symbols).join(',')}`;
}

async function reconcileReservation(quota: DailyQuotaGuard | undefined, reservation: QuotaReservation | undefined, consumedUnits: number): Promise<void> {
  if (!reservation || !quota?.ledger) return;
  await quota.ledger.reconcile({ reservationId: reservation.reservationId, consumedUnits });
}

function isQuotaExhausted(error: unknown): boolean {
  return error instanceof Error && /quota(?:[- ]| monthly )?exhausted/i.test(error.message);
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
