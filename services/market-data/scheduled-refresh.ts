import { runAndRecordDailyPriceRefresh, type DailyPricePersistence, type DailyRefreshJobResult, type DailyRefreshRetryOptions, type DailyRefreshRunRecorder, type DailyQuotaGuard } from '@/services/market-data/daily-refresh';
import type { DailyPriceProvider } from '@/services/market-data/types';
import { eligibleEodTradingDate, type UsEquityCalendarOverrides } from '@/services/market-data/us-equity-calendar';

export type ActiveSymbolSource = { list(): Promise<string[]>; listDetailed?(): Promise<{ symbols: string[]; unresolvedInstrumentIds: string[] }> };
export type RefreshClaimStore = { tryClaim(key: string): Promise<boolean>; release(key: string): Promise<void> };
export type ScheduledRefreshDependencies = { symbols: ActiveSymbolSource; provider: DailyPriceProvider; persistence: DailyPricePersistence; recorder: DailyRefreshRunRecorder; retry?: DailyRefreshRetryOptions; quota?: DailyQuotaGuard; calendarOverrides?: UsEquityCalendarOverrides; claimStore?: RefreshClaimStore };

/** Scheduler composition used by Cloudflare cron and local job tests. */
export async function runScheduledPriceRefresh(now: Date, dependencies: ScheduledRefreshDependencies): Promise<DailyRefreshJobResult> {
  const discovered = dependencies.symbols.listDetailed ? await dependencies.symbols.listDetailed() : { symbols: await dependencies.symbols.list(), unresolvedInstrumentIds: [] };
  // Claims are per symbol and NY trading date. Sort and deduplicate symbols so
  // equivalent active-symbol reads share the same claim names, while a retry
  // with a smaller or larger active set still cannot duplicate an overlapping
  // provider request.
  const claimDate = eligibleEodTradingDate(now, 18, dependencies.calendarOverrides) ?? now.toISOString().slice(0, 10);
  const claimSymbols = [...new Set(discovered.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
  const claimKeys = claimSymbols.map((symbol) => `daily-refresh:${claimDate}:${symbol}`);
  const claimedKeys: string[] = [];
  if (dependencies.claimStore) {
    try {
      for (const key of claimKeys) {
        if (!(await dependencies.claimStore.tryClaim(key))) {
          for (const claimedKey of claimedKeys) await dependencies.claimStore.release(claimedKey);
          return { status: 'skipped', reason: 'already_running' };
        }
        claimedKeys.push(key);
      }
    } catch (error) {
      for (const claimedKey of claimedKeys) await dependencies.claimStore.release(claimedKey);
      throw error;
    }
  }
  try {
    return await runAndRecordDailyPriceRefresh(now, discovered.symbols, dependencies.provider, dependencies.persistence, dependencies.recorder, dependencies.retry, dependencies.quota, dependencies.calendarOverrides, discovered.unresolvedInstrumentIds.length);
  } finally {
    for (const key of claimedKeys) await dependencies.claimStore?.release(key);
  }
}
