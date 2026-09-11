import { runAndRecordDailyPriceRefresh, type DailyPricePersistence, type DailyRefreshJobResult, type DailyRefreshRetryOptions, type DailyRefreshRunRecorder, type DailyQuotaGuard } from '@/services/market-data/daily-refresh';
import type { DailyPriceProvider } from '@/services/market-data/types';
import { eligibleEodTradingDate, type UsEquityCalendarOverrides } from '@/services/market-data/us-equity-calendar';

export type ActiveSymbolSource = { list(): Promise<string[]>; listDetailed?(): Promise<{ symbols: string[]; unresolvedInstrumentIds: string[] }> };
export type RefreshClaimStore = { tryClaim(key: string): Promise<boolean>; release(key: string): Promise<void> };
export type ScheduledRefreshDependencies = { symbols: ActiveSymbolSource; provider: DailyPriceProvider; persistence: DailyPricePersistence; recorder: DailyRefreshRunRecorder; retry?: DailyRefreshRetryOptions; quota?: DailyQuotaGuard; calendarOverrides?: UsEquityCalendarOverrides; claimStore?: RefreshClaimStore };

/** Scheduler composition used by Cloudflare cron and local job tests. */
export async function runScheduledPriceRefresh(now: Date, dependencies: ScheduledRefreshDependencies): Promise<DailyRefreshJobResult> {
  const discovered = dependencies.symbols.listDetailed ? await dependencies.symbols.listDetailed() : { symbols: await dependencies.symbols.list(), unresolvedInstrumentIds: [] };
  // Claims represent one provider attempt for a NY trading date. Sort and
  // deduplicate symbols so equivalent active-symbol reads share one claim,
  // even when their database order differs or UTC crosses midnight first.
  const claimDate = eligibleEodTradingDate(now, 18, dependencies.calendarOverrides) ?? now.toISOString().slice(0, 10);
  const claimSymbols = [...new Set(discovered.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
  const key = `daily-refresh:${claimDate}:${claimSymbols.join(',')}`;
  if (dependencies.claimStore && !(await dependencies.claimStore.tryClaim(key))) return { status: 'skipped', reason: 'already_running' };
  try {
    return await runAndRecordDailyPriceRefresh(now, discovered.symbols, dependencies.provider, dependencies.persistence, dependencies.recorder, dependencies.retry, dependencies.quota, dependencies.calendarOverrides, discovered.unresolvedInstrumentIds.length);
  } finally {
    await dependencies.claimStore?.release(key);
  }
}
