import { api, createApi, type ApiBindings } from '@/services/api/app';
import { SharedRateLimitStore } from '@/services/security/request-security';
import { CloudflareDurableObjectCounterStore, RateLimitCounterDurableObject } from '@/workers/rate-limit-counter';
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
import { handleScheduledDeletion } from '@/workers/scheduled-deletion';
import { SupabaseDeletionExecutorRepository } from '@/services/supabase/deletion-executor-repository';
import { SupabaseDeletionEffects } from '@/services/supabase/deletion-effects';
import { createStripeCustomerCancellation } from '@/services/billing/stripe-http';
import type { QueueProducer } from '@/services/queues/scheduled-outbox';
import { readCalendarOverrides } from '@/services/market-data/calendar-config';
import { CloudflareDurableObjectRefreshClaimStore, RefreshClaimDurableObject } from '@/services/market-data/refresh-claim-do';
import { SupabaseLedgerReplayRepository } from '@/services/ledger/persisted-replay';
import { SupabaseReportInputRepository } from '@/services/supabase/report-input-repository';
import { SupabaseReportSnapshotsRepository } from '@/services/supabase/report-snapshots-repository';
import { createReportQueueHandler } from '@/services/reporting/report-queue-runtime';
import { createSupabaseReportContextLoader } from '@/services/reporting/supabase-report-context';
import { resolveReportRange } from '@/services/reporting/report-range';
import { isoDate } from '@/lib/domain/types';
type WorkerBindings = ApiBindings & { REPORT_QUEUE?: QueueProducer; MARKET_CALENDAR_CLOSED_DATES?: string; MARKET_CALENDAR_OPEN_DATES?: string; RATE_LIMIT_COUNTER?: DurableObjectNamespace; REFRESH_CLAIM?: DurableObjectNamespace; REPORT_THROUGH_DATE?: string; REPORT_MAX_LOOKBACK_DAYS?: string; STRIPE_SECRET_KEY?: string };
function scheduledDependencies(environment: WorkerBindings) { if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.MARKETSTACK_API_KEY) throw new Error('Scheduled pricing requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MARKETSTACK_API_KEY secrets.'); const cap = Number(environment.MARKETSTACK_MONTHLY_CAP ?? '100'); const recorder = new SupabaseMarketDataJobRunsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }); return { symbols: new SupabaseActiveSymbolsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), provider: new MarketstackProvider({ apiKey: environment.MARKETSTACK_API_KEY, requestBudget: new MonthlyRequestBudget(cap) }), persistence: new SupabaseDailyPricesRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), recorder, quota: { monthlyCap: cap, getUsedUnits: (now: Date) => recorder.getMonthlyQuotaUsage(now) }, claimStore: environment.REFRESH_CLAIM ? new CloudflareDurableObjectRefreshClaimStore(environment.REFRESH_CLAIM) : undefined, calendarOverrides: readCalendarOverrides(environment) }; }
export { RateLimitCounterDurableObject };
export { RefreshClaimDurableObject };
export default { fetch(request: Request, environment: WorkerBindings, executionContext: ExecutionContext) { const configuredApi = environment.RATE_LIMIT_COUNTER ? createApi({ rateLimitStore: new SharedRateLimitStore(new CloudflareDurableObjectCounterStore(environment.RATE_LIMIT_COUNTER)), log: (entry) => console.info(JSON.stringify(entry)) }) : api; return configuredApi.fetch(request, environment, executionContext); }, scheduled(event: ScheduledEvent, environment: WorkerBindings, context: ExecutionContext) { if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY && environment.REPORT_QUEUE) handleScheduledOutboxDispatch(context, { repository: new SupabaseOutboxRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), reportQueue: environment.REPORT_QUEUE }); if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY) { handleScheduledRetention(event, context, { repository: new SupabaseRawFileRetentionRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), storage: new SupabasePrivateObjectStore({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }) }); if (environment.STRIPE_SECRET_KEY) { const cancelCustomer = createStripeCustomerCancellation({ secretKey: environment.STRIPE_SECRET_KEY }); handleScheduledDeletion(event, context, { repository: new SupabaseDeletionExecutorRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }), effects: new SupabaseDeletionEffects({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY, cancelBillingCustomer: async (_userId, customerId) => { if (customerId) await cancelCustomer(customerId); } }) }); } } if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY && environment.MARKETSTACK_API_KEY) handleScheduledRefresh(event, context, scheduledDependencies(environment)); } };
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

function resolveReportHandlers(environment: WorkerBindings) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.REPORT_THROUGH_DATE) throw new Error('Report queue requires Supabase service-role secrets and REPORT_THROUGH_DATE.');
  const through = isoDate(environment.REPORT_THROUGH_DATE);
  const maxDays = environment.REPORT_MAX_LOOKBACK_DAYS ? Number(environment.REPORT_MAX_LOOKBACK_DAYS) : undefined;
  const ledger = new SupabaseLedgerReplayRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  const market = new SupabaseReportInputRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  const load = createSupabaseReportContextLoader({ ledger, market, calendarOverrides: readCalendarOverrides(environment), resolveRange: (job, replay) => Promise.resolve(resolveReportRange({ job, replay, through, maxDays })) });
  return { load, isCurrent: async (job: Parameters<typeof load>[0], context: Awaited<ReturnType<typeof load>>) => { if (!context) return false; const current = await ledger.get(job.accountId, job.requestedBy); return Boolean(current && [...current.sourceEntryIds].sort().join(',') === context.inputs.importStateRevision.replace(/^ledger:/, '')); }, publisher: new SupabaseReportSnapshotsRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }) };
}

export const reportQueue = createReportQueueHandler(resolveReportHandlers, {
  queueName: 'northstar-reports',
  resolveFailureRecorder: (environment) => {
    if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Report queue requires Supabase service-role secrets.');
    return new SupabaseQueueFailureRepository({ supabaseUrl: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  },
});
