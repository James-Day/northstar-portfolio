import { Hono } from 'hono';
import {
  SessionConfigurationError,
  type AuthenticatedUser,
  verifySupabaseSession,
} from '@/services/auth/server-session';
import { validateCreatePortfolioAccount, type AccountsRepository } from '@/services/accounts/accounts';
import { SupabaseAccountsRepository } from '@/services/supabase/accounts-repository';
import { stageRobinhoodImport, toPersistableImportStage } from '@/services/ingestion/staging';
import { ImportOperationRejectedError, SupabaseImportsRepository, type ImportsRepository } from '@/services/supabase/imports-repository';
import type { PriceFreshnessReportRepository } from '@/services/reporting/price-freshness';
import { SupabasePriceFreshnessReportRepository } from '@/services/supabase/price-freshness-report-repository';
import { SupabaseReportSnapshotReader, type ReportSnapshot } from '@/services/supabase/report-snapshot-reader';
import { SupabaseSignedUploadRepository, type SignedUploadRepository } from '@/services/supabase/signed-upload-repository';
import { SupabaseActivityRepository, type ActivityPage } from '@/services/supabase/activity-repository';
import {
  BillingConfigurationError,
  StripeSignatureError,
  buildBillingReturnUrl,
  resolveBillingPriceId,
  validateStripeSessionUrl,
  verifyStripeWebhook,
  type BillingPlan,
  type StripeBillingHttpDependencies,
} from '@/services/billing/stripe-http';
import { toCsv } from '@/services/privacy/export';

const ACTIVITY_EXPORT_PAGE_SIZE = 100;
const MAX_ACTIVITY_EXPORT_ROWS = 100_000;

export type ApiBindings = {
  APP_ENV?: 'development' | 'staging' | 'production';
  APP_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MARKETSTACK_API_KEY?: string;
  MARKETSTACK_MONTHLY_CAP?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_MONTHLY_PRICE_ID?: string;
  STRIPE_ANNUAL_PRICE_ID?: string;
};

export type ApiDependencies = {
  verifySession?: (request: Request, bindings: ApiBindings) => Promise<AuthenticatedUser | undefined>;
  accountsRepository?: AccountsRepository;
  importsRepository?: ImportsRepository;
  priceFreshnessRepository?: PriceFreshnessReportRepository;
  reportSnapshotReader?: { getLatest(accountId: string, accessToken: string): Promise<ReportSnapshot | undefined> };
  signedUploadRepository?: SignedUploadRepository;
  activityRepository?: { list(accountId: string, accessToken: string, input?: { limit?: number; offset?: number }): Promise<ActivityPage> };
  deletionRequestRepository?: { request(userId: string, accessToken: string): Promise<{ id: string; status: string; requestedAt: string }> };
  billing?: StripeBillingHttpDependencies;
};

export function createApi(dependencies: ApiDependencies = {}) {
  const api = new Hono<{ Bindings: ApiBindings }>();
  const verifySession = dependencies.verifySession ?? ((request, bindings) =>
    verifySupabaseSession(request, {
      supabaseUrl: bindings.SUPABASE_URL,
      supabaseAnonKey: bindings.SUPABASE_ANON_KEY,
    }));
  const accountsRepository = dependencies.accountsRepository;
  const importsRepository = dependencies.importsRepository;
  const priceFreshnessRepository = dependencies.priceFreshnessRepository;
  const reportSnapshotReader = dependencies.reportSnapshotReader;
  const signedUploadRepository = dependencies.signedUploadRepository;
  const activityRepository = dependencies.activityRepository;
  const deletionRequestRepository = dependencies.deletionRequestRepository;
  const billing = dependencies.billing;

  api.use('*', async (context, next) => {
    const origin = context.req.header('origin');
    const bindings = context.env ?? {};
    const allowedOrigin = bindings.APP_ORIGIN?.trim() || (bindings.APP_ENV !== 'production' ? 'http://localhost:3000' : undefined);
    if (origin && allowedOrigin && origin === allowedOrigin) {
      context.header('access-control-allow-origin', origin);
      context.header('vary', 'Origin');
      context.header('access-control-allow-headers', 'authorization,content-type,x-file-name');
      context.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (context.req.method === 'OPTIONS') return context.body(null, 204);
    await next();
  });

  api.get('/health', (context) =>
    context.json({
      status: 'ok',
      service: 'northstar-api',
      environment: context.env.APP_ENV ?? 'development',
    }),
  );

  api.post('/v1/billing/stripe/webhook', async (context) => {
    if (!billing) return context.json({ error: 'billing_unavailable' }, 503);
    const rawBody = await context.req.text();
    try {
      const event = await verifyStripeWebhook(rawBody, context.req.header('stripe-signature'), context.env.STRIPE_WEBHOOK_SECRET);
      await billing.handleVerifiedWebhook(event);
      return context.json({ received: true });
    } catch (error) {
      if (error instanceof StripeSignatureError) return context.json({ error: 'invalid_webhook' }, 400);
      throw error;
    }
  });

  api.post('/v1/billing/checkout', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    if (!billing) return context.json({ error: 'billing_unavailable' }, 503);
    const body = await context.req.json().catch(() => null) as { plan?: unknown } | null;
    if (!body || (body.plan !== 'monthly' && body.plan !== 'annual')) return context.json({ error: 'invalid_plan' }, 400);
    try {
      const plan = body.plan as BillingPlan;
      const priceId = resolveBillingPriceId(plan, { monthly: context.env.STRIPE_MONTHLY_PRICE_ID, annual: context.env.STRIPE_ANNUAL_PRICE_ID });
      const result = await billing.createCheckoutSession({
        userId: authenticated.user.id,
        accessToken: authenticated.accessToken,
        priceId,
        successUrl: buildBillingReturnUrl(context.env.APP_ORIGIN, '/dashboard?billing=success'),
        cancelUrl: buildBillingReturnUrl(context.env.APP_ORIGIN, '/dashboard?billing=cancelled'),
      });
      return context.json({ url: validateStripeSessionUrl(result.url) });
    } catch (error) {
      if (error instanceof BillingConfigurationError) return context.json({ error: 'billing_unavailable' }, 503);
      throw error;
    }
  });

  api.post('/v1/billing/portal', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    if (!billing) return context.json({ error: 'billing_unavailable' }, 503);
    try {
      const result = await billing.createBillingPortalSession({
        userId: authenticated.user.id,
        accessToken: authenticated.accessToken,
        returnUrl: buildBillingReturnUrl(context.env.APP_ORIGIN, '/dashboard?billing=cancelled'),
      });
      return context.json({ url: validateStripeSessionUrl(result.url) });
    } catch (error) {
      if (error instanceof BillingConfigurationError) return context.json({ error: 'billing_unavailable' }, 503);
      throw error;
    }
  });

  api.post('/v1/me/deletion-request', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    if (!deletionRequestRepository) return context.json({ error: 'deletion_unavailable' }, 503);
    const request = await deletionRequestRepository.request(authenticated.user.id, authenticated.accessToken);
    return context.json({ request }, 202);
  });

  api.get('/v1/me', async (context) => {
    try {
      const user = await verifySession(context.req.raw, context.env);
      if (!user) return context.json({ error: 'unauthorized' }, 401);
      return context.json({ user });
    } catch (error) {
      if (error instanceof SessionConfigurationError) {
        return context.json({ error: 'service_unavailable' }, 503);
      }
      throw error;
    }
  });

  api.get('/v1/accounts', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const repository = accountsRepository ?? createAccountsRepository(context.env);
    return context.json({ accounts: await repository.list(authenticated.user.id, authenticated.accessToken) });
  });

  api.post('/v1/accounts', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const input = validateCreatePortfolioAccount(await context.req.json());
    const repository = accountsRepository ?? createAccountsRepository(context.env);
    const account = await repository.create(authenticated.user.id, authenticated.accessToken, input);
    return context.json({ account }, 201);
  });

  api.get('/v1/accounts/:accountId/price-freshness', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const repository = priceFreshnessRepository ?? createPriceFreshnessRepository(context.env);
    if (!repository) return context.json({ error: 'reporting_unavailable' }, 503);
    const report = await repository.get(context.req.param('accountId'), authenticated.user.id, authenticated.accessToken);
    if (!report) return context.json({ error: 'not_found' }, 404);
    return context.json({ report });
  });

  api.get('/v1/accounts/:accountId/report', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const reader = reportSnapshotReader ?? createReportSnapshotReader(context.env);
    if (!reader) return context.json({ error: 'reporting_unavailable' }, 503);
    const snapshot = await reader.getLatest(context.req.param('accountId'), authenticated.accessToken);
    if (!snapshot) return context.json({ error: 'not_found' }, 404);
    return context.json({ snapshot });
  });

  api.get('/v1/accounts/:accountId/activity', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    if (!await accounts.get(authenticated.user.id, authenticated.accessToken, accountId)) return context.json({ error: 'not_found' }, 404);
    let limit: number | undefined;
    let offset: number | undefined;
    try {
      limit = parseIntegerQuery(context.req.query('limit'));
      offset = parseIntegerQuery(context.req.query('offset'));
    } catch {
      return context.json({ error: 'invalid_pagination' }, 400);
    }
    const repository = activityRepository ?? createActivityRepository(context.env);
    return context.json({ activity: await repository.list(accountId, authenticated.accessToken, { limit, offset }) });
  });

  api.get('/v1/accounts/:accountId/activity.csv', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    if (!await accounts.get(authenticated.user.id, authenticated.accessToken, accountId)) return context.json({ error: 'not_found' }, 404);
    const repository = activityRepository ?? createActivityRepository(context.env);
    const activity = await readAllActivityForExport(repository, accountId, authenticated.accessToken);
    const csv = toCsv(['date', 'type', 'instrument', 'quantity', 'unit_price', 'cash_amount', 'external_flow', 'description', 'source_row'], activity.map((item) => [item.effectiveDate, item.entryType, item.instrumentId, item.quantity, item.unitPrice, item.cashAmount, item.externalFlow, item.description, item.sourceRow?.rowNumber ?? '']));
    context.header('content-type', 'text/csv; charset=utf-8');
    context.header('content-disposition', `attachment; filename="portfolio-activity-${accountId}.csv"`);
    return context.body(csv);
  });

  api.get('/v1/accounts/:accountId/report.csv', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    if (!await accounts.get(authenticated.user.id, authenticated.accessToken, accountId)) return context.json({ error: 'not_found' }, 404);
    const reader = reportSnapshotReader ?? createReportSnapshotReader(context.env);
    if (!reader) return context.json({ error: 'reporting_unavailable' }, 503);
    const snapshot = await reader.getLatest(accountId, authenticated.accessToken);
    if (!snapshot) return context.json({ error: 'not_found' }, 404);
    const payload = snapshot.payload as {
      totalValue?: unknown;
      cash?: unknown;
      timeWeightedReturn?: unknown;
      netDeposits?: unknown;
      dividendIncome?: unknown;
      realizedGainLoss?: unknown;
      activityCoveredThrough?: unknown;
      pricesThrough?: unknown;
      holdings?: Array<{ instrumentId: unknown; displayName?: unknown; quantity: unknown; close?: unknown; value?: unknown }>;
    };
    const rows: unknown[][] = [
      ['snapshot', 'as_of_date', snapshot.asOfDate, '', '', ''],
      ['summary', 'total_value', payload.totalValue, '', '', ''],
      ['summary', 'cash', payload.cash, '', '', ''],
      ['summary', 'time_weighted_return', payload.timeWeightedReturn, '', '', ''],
      ['summary', 'net_deposits', payload.netDeposits ?? '', '', '', ''],
      ['summary', 'dividend_income', payload.dividendIncome ?? '', '', '', ''],
      ['summary', 'realized_gain_loss', payload.realizedGainLoss ?? '', '', '', ''],
      ['coverage', 'activity_covered_through', payload.activityCoveredThrough ?? '', '', '', ''],
      ['coverage', 'prices_through', payload.pricesThrough ?? '', '', '', ''],
    ];
    for (const holding of payload.holdings ?? []) rows.push(['holding', holding.instrumentId, holding.displayName ?? '', holding.quantity, holding.close ?? '', holding.value ?? '']);
    const csv = toCsv(['section', 'field_or_symbol', 'value_or_name', 'quantity', 'close', 'value'], rows);
    context.header('content-type', 'text/csv; charset=utf-8');
    context.header('content-disposition', `attachment; filename="portfolio-report-${accountId}.csv"`);
    return context.body(csv);
  });

  api.post('/v1/accounts/:accountId/import-preview', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    const account = await accounts.get(authenticated.user.id, authenticated.accessToken, accountId);
    if (!account) return context.json({ error: 'not_found' }, 404);
    const contentType = context.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/csv')) return context.json({ error: 'unsupported_media_type' }, 415);
    const staged = await stageRobinhoodImport(accountId, await context.req.text());
    const imports = importsRepository ?? createImportsRepository(context.env);
    const duplicateFile = await imports.hasFileHash(accountId, authenticated.accessToken, staged.fileSha256);
    return context.json({ import: { ...staged, duplicateFile } });
  });

  api.post('/v1/accounts/:accountId/upload-url', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const body = await context.req.json().catch(() => null) as { fileName?: unknown } | null;
    if (!body || typeof body.fileName !== 'string') return context.json({ error: 'file_name_required' }, 400);
    const repository = signedUploadRepository ?? createSignedUploadRepository(context.env);
    const upload = await repository.create(authenticated.user.id, authenticated.accessToken, context.req.param('accountId'), body.fileName);
    if (!upload) return context.json({ error: 'not_found' }, 404);
    return context.json({ upload }, 201);
  });

  api.post('/v1/accounts/:accountId/imports', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    const account = await accounts.get(authenticated.user.id, authenticated.accessToken, accountId);
    if (!account) return context.json({ error: 'not_found' }, 404);
    const contentType = context.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/csv')) return context.json({ error: 'unsupported_media_type' }, 415);
    const fileName = context.req.header('x-file-name') ?? '';
    const staged = await stageRobinhoodImport(accountId, await context.req.text());
    const imports = importsRepository ?? createImportsRepository(context.env);
    if (await imports.hasFileHash(accountId, authenticated.accessToken, staged.fileSha256)) {
      return context.json({ error: 'duplicate_file' }, 409);
    }
    const importRecord = await imports.stage(authenticated.accessToken, toPersistableImportStage(staged, fileName));
    return context.json({ import: { ...importRecord, review: staged.review, activityFrom: staged.activityFrom, activityThrough: staged.activityThrough } }, 201);
  });

  api.get('/v1/accounts/:accountId/imports', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const accountId = context.req.param('accountId');
    const accounts = accountsRepository ?? createAccountsRepository(context.env);
    if (!await accounts.get(authenticated.user.id, authenticated.accessToken, accountId)) return context.json({ error: 'not_found' }, 404);
    const imports = importsRepository ?? createImportsRepository(context.env);
    return context.json({ imports: await imports.list(accountId, authenticated.accessToken) });
  });

  api.get('/v1/imports/:importId', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const imports = importsRepository ?? createImportsRepository(context.env);
    const detail = await imports.get(context.req.param('importId'), authenticated.accessToken);
    if (!detail) return context.json({ error: 'not_found' }, 404);
    return context.json(detail);
  });

  api.post('/v1/imports/:importId/discard', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const imports = importsRepository ?? createImportsRepository(context.env);
    const importRecord = await imports.discard(context.req.param('importId'), authenticated.accessToken);
    if (!importRecord) return context.json({ error: 'not_found_or_not_discardable' }, 404);
    return context.json({ import: importRecord });
  });

  api.post('/v1/imports/:importId/commit', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const imports = importsRepository ?? createImportsRepository(context.env);
    let importRecord;
    try {
      importRecord = await imports.commit(context.req.param('importId'), authenticated.accessToken);
    } catch (error) {
      if (error instanceof ImportOperationRejectedError) return context.json({ error: 'review_issues_must_be_resolved' }, 409);
      throw error;
    }
    if (!importRecord) return context.json({ error: 'not_found_or_not_committable' }, 404);
    return context.json({ import: importRecord });
  });

  api.post('/v1/imports/:importId/undo', async (context) => {
    const authenticated = await requireSession(context.req.raw, context.env, verifySession);
    if (authenticated instanceof Response) return authenticated;
    const imports = importsRepository ?? createImportsRepository(context.env);
    let importRecord;
    try {
      importRecord = await imports.undo(context.req.param('importId'), authenticated.accessToken);
    } catch (error) {
      if (error instanceof ImportOperationRejectedError) return context.json({ error: 'only_the_latest_committed_import_can_be_undone' }, 409);
      throw error;
    }
    if (!importRecord) return context.json({ error: 'not_found_or_not_undoable' }, 404);
    return context.json({ import: importRecord });
  });

  return api;
}

/**
 * Export is intentionally assembled from the same account-scoped reader used by
 * the activity screen. Walking pages keeps the download complete without adding
 * an unbounded Supabase request; the progress guard prevents a faulty repository
 * from creating an infinite loop.
 */
async function readAllActivityForExport(
  repository: { list(accountId: string, accessToken: string, input?: { limit?: number; offset?: number }): Promise<ActivityPage> },
  accountId: string,
  accessToken: string,
) {
  const items: ActivityPage['items'] = [];
  let offset = 0;
  while (true) {
    const page = await repository.list(accountId, accessToken, { limit: ACTIVITY_EXPORT_PAGE_SIZE, offset });
    if (page.items.length === 0 && page.hasMore) throw new Error('Activity export pagination made no progress.');
    if (items.length + page.items.length > MAX_ACTIVITY_EXPORT_ROWS) throw new Error('Activity export exceeds the maximum supported row count.');
    items.push(...page.items);
    if (!page.hasMore) return items;
    offset += page.items.length;
  }
}

export const api = createApi();

async function requireSession(
  request: Request,
  bindings: ApiBindings,
  verifySession: (request: Request, bindings: ApiBindings) => Promise<AuthenticatedUser | undefined>,
): Promise<{ user: AuthenticatedUser; accessToken: string } | Response> {
  try {
    const accessToken = readBearerToken(request);
    if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const user = await verifySession(request, bindings);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    return { user, accessToken };
  } catch (error) {
    if (error instanceof SessionConfigurationError) return Response.json({ error: 'service_unavailable' }, { status: 503 });
    throw error;
  }
}

function createAccountsRepository(bindings: ApiBindings): AccountsRepository {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseAccountsRepository({ supabaseUrl: bindings.SUPABASE_URL, supabaseAnonKey: bindings.SUPABASE_ANON_KEY });
}

function createImportsRepository(bindings: ApiBindings): ImportsRepository {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseImportsRepository({ supabaseUrl: bindings.SUPABASE_URL, supabaseAnonKey: bindings.SUPABASE_ANON_KEY });
}

function createPriceFreshnessRepository(bindings: ApiBindings): PriceFreshnessReportRepository | undefined {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  return new SupabasePriceFreshnessReportRepository({ supabaseUrl: bindings.SUPABASE_URL, serviceRoleKey: bindings.SUPABASE_SERVICE_ROLE_KEY });
}

function createReportSnapshotReader(bindings: ApiBindings) {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) return undefined;
  return new SupabaseReportSnapshotReader({ supabaseUrl: bindings.SUPABASE_URL, anonKey: bindings.SUPABASE_ANON_KEY });
}

function createSignedUploadRepository(bindings: ApiBindings): SignedUploadRepository {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseSignedUploadRepository({
    supabaseUrl: bindings.SUPABASE_URL,
    supabaseAnonKey: bindings.SUPABASE_ANON_KEY,
    accounts: new SupabaseAccountsRepository({ supabaseUrl: bindings.SUPABASE_URL, supabaseAnonKey: bindings.SUPABASE_ANON_KEY }),
  });
}

function createActivityRepository(bindings: ApiBindings) {
  if (!bindings.SUPABASE_URL || !bindings.SUPABASE_ANON_KEY) throw new SessionConfigurationError();
  return new SupabaseActivityRepository({ supabaseUrl: bindings.SUPABASE_URL, anonKey: bindings.SUPABASE_ANON_KEY });
}

function parseIntegerQuery(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error('Pagination values must be non-negative integers.');
  return Number(value);
}

function readBearerToken(request: Request): string | undefined {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
