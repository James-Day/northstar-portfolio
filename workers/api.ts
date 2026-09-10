import { api, type ApiBindings } from '@/services/api/app';
import { MonthlyRequestBudget, MarketstackProvider } from '@/services/market-data/marketstack';
import { handleScheduledRefresh } from '@/workers/scheduled-refresh';
import { SupabaseActiveSymbolsRepository } from '@/services/supabase/active-symbols-repository';
import { SupabaseDailyPricesRepository } from '@/services/supabase/daily-prices-repository';
import { SupabaseMarketDataJobRunsRepository } from '@/services/supabase/market-data-job-runs-repository';
import { createCloudflareQueueHandler } from '@/services/queues/cloudflare';
import { createImportQueueHandlers } from '@/services/queues/import-worker';
import { SupabaseImportJobRepository } from '@/services/supabase/import-job-repository';
import { SupabaseQueueFailureRepository } from '@/services/supabase/queue-failure-repository';
import { handleScheduledOutboxDispatch } from '@/services/queues/scheduled-outbox';
import { SupabaseOutboxRepository } from '@/services/supabase/outbox-repository';
import { SupabasePrivateObjectStore, SupabaseRawFileRetentionRepository } from '@/services/supabase/raw-file-retention-repository';
import { handleScheduledRetention } from '@/workers/scheduled-retention';
import type { QueueProducer } from '@/services/queues/scheduled-outbox';
type WorkerBindings = ApiBindings & { REPORT_QUEUE?: QueueProducer };
function scheduledDependencies(environment: WorkerBindings) { if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.MARKETSTACK_API_KEY) throw new Error('Scheduled pricing requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MARKETSTACK_API_KEY secrets.'); const cap = Number(environment.MARKETSTACK_MONTHLY_CAP ?? '100'); const recorder = new SupabaseMarketDataJobRunsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }); return { symbols: new SupabaseActiveSymbolsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), provider: new MarketstackProvider({ apiKey: environment.MARKETSTACK_API_KEY, requestBudget: new MonthlyRequestBudget(cap) }), persistence: new SupabaseDailyPricesRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), recorder, quota: { monthlyCap: cap, getUsedUnits: (now: Date) => recorder.getMonthlyQuotaUsage(now) } }; }
export default { fetch(request: Request, environment: WorkerBindings, executionContext: ExecutionContext) { return api.fetch(request, environment, executionContext); }, scheduled(event: ScheduledEvent, environment: WorkerBindings, context: ExecutionContext) { if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY && environment.REPORT_QUEUE) handleScheduledOutboxDispatch(context, { repository: new SupabaseOutboxRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), reportQueue: environment.REPORT_QUEUE }); if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY) handleScheduledRetention(event, context, { repository: new SupabaseRawFileRetentionRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), storage: new SupabasePrivateObjectStore({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }) }); handleScheduledRefresh(event, context, scheduledDependencies(environment)); } };
function resolveImportHandlers(environment: WorkerBindings) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Import queue requires Supabase service-role secrets.');
  return createImportQueueHandlers(new SupabaseImportJobRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }));
}
export const queue = createCloudflareQueueHandler(resolveImportHandlers, {
  queueName: 'northstar-imports',
  resolveFailureRecorder: (environment) => {
    if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Import queue requires Supabase service-role secrets.');
    return new SupabaseQueueFailureRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  },
});
