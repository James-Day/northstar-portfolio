import { runAndRecordDailyPriceRefresh, type DailyPricePersistence, type DailyRefreshJobResult, type DailyRefreshRetryOptions, type DailyRefreshRunRecorder } from '@/services/market-data/daily-refresh';
import type { DailyPriceProvider } from '@/services/market-data/types';

export type ActiveSymbolSource = { list(): Promise<string[]> };
export type ScheduledRefreshDependencies = { symbols: ActiveSymbolSource; provider: DailyPriceProvider; persistence: DailyPricePersistence; recorder: DailyRefreshRunRecorder; retry?: DailyRefreshRetryOptions };

/** Scheduler composition used by Cloudflare cron and local job tests. */
export async function runScheduledPriceRefresh(now: Date, dependencies: ScheduledRefreshDependencies): Promise<DailyRefreshJobResult> {
  const activeSymbols = await dependencies.symbols.list();
  return runAndRecordDailyPriceRefresh(now, activeSymbols, dependencies.provider, dependencies.persistence, dependencies.recorder, dependencies.retry);
}
