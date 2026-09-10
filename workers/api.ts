import { api, type ApiBindings } from '@/services/api/app';
import { MonthlyRequestBudget, MarketstackProvider } from '@/services/market-data/marketstack';
import { handleScheduledRefresh } from '@/workers/scheduled-refresh';
import { SupabaseActiveSymbolsRepository } from '@/services/supabase/active-symbols-repository';
import { SupabaseDailyPricesRepository } from '@/services/supabase/daily-prices-repository';
import { SupabaseMarketDataJobRunsRepository } from '@/services/supabase/market-data-job-runs-repository';

function scheduledDependencies(environment: ApiBindings) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.MARKETSTACK_API_KEY) throw new Error('Scheduled pricing requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MARKETSTACK_API_KEY secrets.');
  const cap = Number(environment.MARKETSTACK_MONTHLY_CAP ?? '100');
  const recorder = new SupabaseMarketDataJobRunsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  return {
    symbols: new SupabaseActiveSymbolsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
    provider: new MarketstackProvider({ apiKey: environment.MARKETSTACK_API_KEY, requestBudget: new MonthlyRequestBudget(cap) }),
    persistence: new SupabaseDailyPricesRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
    recorder,
    quota: { monthlyCap: cap, getUsedUnits: (now: Date) => recorder.getMonthlyQuotaUsage(now) },
  };
}

export default {
  fetch(request: Request, environment: ApiBindings, executionContext: ExecutionContext) {
    return api.fetch(request, environment, executionContext);
  },
  scheduled(event: ScheduledEvent, environment: ApiBindings, context: ExecutionContext) {
    handleScheduledRefresh(event, context, scheduledDependencies(environment));
  },
};
