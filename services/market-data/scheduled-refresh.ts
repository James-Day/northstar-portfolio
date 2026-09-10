import { runAndRecordDailyPriceRefresh, type DailyPricePersistence, type DailyRefreshJobResult, type DailyRefreshRetryOptions, type DailyRefreshRunRecorder, type DailyQuotaGuard } from '@/services/market-data/daily-refresh';
import type { DailyPriceProvider } from '@/services/market-data/types';
import type { UsEquityCalendarOverrides } from '@/services/market-data/us-equity-calendar';

export type ActiveSymbolSource = { list(): Promise<string[]> };
export type ScheduledRefreshDependencies = { symbols: ActiveSymbolSource; provider: DailyPriceProvider; persistence: DailyPricePersistence; recorder: DailyRefreshRunRecorder; retry?: DailyRefreshRetryOptions; quota?: DailyQuotaGuard; calendarOverrides?: UsEquityCalendarOverrides };

/** Scheduler composition used by Cloudflare cron and local job tests. */
export async function runScheduledPriceRefresh(now: Date, dependencies: ScheduledRefreshDependencies): Promise<DailyRefreshJobResult> {
  const activeSymbols = await dependencies.symbols.list();
  return runAndRecordDailyPriceRefresh(now, activeSymbols, dependencies.provider, dependencies.persistence, dependencies.recorder, dependencies.retry, dependencies.quota, dependencies.calendarOverrides);
}
