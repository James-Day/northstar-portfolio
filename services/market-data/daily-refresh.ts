import type { IsoDate } from '@/lib/domain/types';
import type { DailyPrice, DailyPriceProvider } from '@/services/market-data/types';
import { eligibleEodTradingDate } from '@/services/market-data/us-equity-calendar';

export type DailyRefreshResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' }
  | { status: 'ready_to_persist'; tradingDate: IsoDate; requestedSymbols: string[]; prices: DailyPrice[] };

export type DailyPricePersistence = {
  persist(input: { tradingDate: IsoDate; prices: DailyPrice[] }): Promise<{ upserted: number }>;
};

export type DailyRefreshJobResult =
  | { status: 'skipped'; reason: 'before_close_or_non_trading_day' | 'no_active_symbols' }
  | { status: 'persisted'; tradingDate: IsoDate; requestedSymbols: string[]; upserted: number };

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
