import { describe, expect, it } from 'vitest';
import { createApi } from '@/services/api/app';
import { ImportOperationRejectedError } from '@/services/supabase/imports-repository';
import { parseOpeningHistory } from '@/services/accounts/opening-history';
import type { Entitlement } from '@/services/billing/entitlements';

describe('standalone API', () => {
  const trialEntitlement = (status: Entitlement['status'] = 'trialing'): Entitlement => ({ status, trialStartedAt: new Date('2026-01-01T00:00:00Z'), trialEndsAt: new Date('2099-01-15T00:00:00Z'), processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null });

  it('returns a truthful authenticated billing status', async () => {
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), billingPersistence: { getEntitlement: async () => trialEntitlement(), startTrialAfterCommittedImport: async () => trialEntitlement(), applyVerifiedWebhook: async () => trialEntitlement() } });
    const response = await app.request('http://api.test/v1/billing/status', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ entitlement: { status: 'trialing' }, access: { allowed: true, reason: 'trialing' } });
  });

  it('blocks persisted report reads after cancellation while leaving billing status explicit', async () => {
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), billingPersistence: { getEntitlement: async () => trialEntitlement('canceled'), startTrialAfterCommittedImport: async () => trialEntitlement('canceled'), applyVerifiedWebhook: async () => trialEntitlement('canceled') } });
    const response = await app.request('http://api.test/v1/accounts/account-1/report', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({ error: 'entitlement_required', reason: 'canceled', trialEndsAt: '2099-01-15T00:00:00.000Z' });
  });

  it('accepts a signed Stripe webhook using the untouched request body and injects processing', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_api_123', type: 'customer.subscription.updated', created: timestamp, data: { object: { id: 'sub_123' } } });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
    const signature = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    let received: unknown;
    const app = createApi({ billing: { createCheckoutSession: async () => ({ url: '' }), createBillingPortalSession: async () => ({ url: '' }), handleVerifiedWebhook: async (event) => { received = event; } } });
    const response = await app.request('http://api.test/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(received).toMatchObject({ id: 'evt_api_123', type: 'customer.subscription.updated' });
  });

  it('rejects unsigned Stripe webhook requests before invoking billing', async () => {
    let invoked = false;
    const app = createApi({ billing: { createCheckoutSession: async () => ({ url: '' }), createBillingPortalSession: async () => ({ url: '' }), handleVerifiedWebhook: async () => { invoked = true; } } });
    const response = await app.request('http://api.test/v1/billing/stripe/webhook', { method: 'POST', body: '{}' }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_webhook' });
    expect(invoked).toBe(false);
  });

  it('creates an authenticated checkout session from a server-selected price', async () => {
    const calls: unknown[] = [];
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      billing: {
        createCheckoutSession: async (input) => { calls.push(input); return { url: 'https://checkout.stripe.com/c/pay/cs_test' }; },
        createBillingPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session_test' }),
        handleVerifiedWebhook: async () => undefined,
      },
    });
    const response = await app.request('http://api.test/v1/billing/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly', priceId: 'price_attacker_value' }),
    }, { APP_ORIGIN: 'https://app.example.com', STRIPE_MONTHLY_PRICE_ID: 'price_monthlytest' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test' });
    expect(calls).toEqual([{
      userId: 'user-123',
      accessToken: 'session-token',
      priceId: 'price_monthlytest',
      successUrl: 'https://app.example.com/dashboard?billing=success',
      cancelUrl: 'https://app.example.com/dashboard?billing=cancelled',
    }]);
  });

  it('creates an authenticated billing portal session using the same app origin', async () => {
    let received: unknown;
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      billing: {
        createCheckoutSession: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test' }),
        createBillingPortalSession: async (input) => { received = input; return { url: 'https://billing.stripe.com/p/session_test' }; },
        handleVerifiedWebhook: async () => undefined,
      },
    });
    const response = await app.request('http://api.test/v1/billing/portal', { method: 'POST', headers: { authorization: 'Bearer session-token' } }, { APP_ORIGIN: 'https://app.example.com' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: 'https://billing.stripe.com/p/session_test' });
    expect(received).toEqual({ userId: 'user-123', accessToken: 'session-token', returnUrl: 'https://app.example.com/dashboard?billing=cancelled' });
  });

  it('rejects invalid plans, missing configured prices and unsafe session URLs', async () => {
    const billing = {
      createCheckoutSession: async () => ({ url: 'http://unsafe.example.test/session' }),
      createBillingPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session_test' }),
      handleVerifiedWebhook: async () => undefined,
    };
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), billing });
    const invalidPlan = await app.request('http://api.test/v1/billing/checkout', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'weekly' }) }, { STRIPE_MONTHLY_PRICE_ID: 'price_monthlytest' });
    expect(invalidPlan.status).toBe(400);
    const missingPrice = await app.request('http://api.test/v1/billing/checkout', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'annual' }) }, { STRIPE_MONTHLY_PRICE_ID: 'price_monthlytest' });
    expect(missingPrice.status).toBe(503);
    const unsafeUrl = await app.request('http://api.test/v1/billing/checkout', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'monthly' }) }, { STRIPE_MONTHLY_PRICE_ID: 'price_monthlytest' });
    expect(unsafeUrl.status).toBe(503);
  });

  it('serves a deployment-safe health response without exposing bindings', async () => {
    const app = createApi();
    const response = await app.request('http://api.test/health', undefined, {
      APP_ENV: 'production',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'northstar-api',
      environment: 'production',
    });
  });

  it('allows the configured app origin to stage authenticated browser requests without opening the API to other origins', async () => {
    const app = createApi();
    const allowed = await app.request('http://api.test/health', { headers: { origin: 'https://app.example.com' } }, { APP_ENV: 'production', APP_ORIGIN: 'https://app.example.com' });
    const rejected = await app.request('http://api.test/health', { headers: { origin: 'https://other.example.com' } }, { APP_ENV: 'production', APP_ORIGIN: 'https://app.example.com' });

    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('protects private routes with a server-verified session', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123', email: 'person@example.com' }),
    });

    const response = await app.request('http://api.test/v1/me');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: { id: 'user-123', email: 'person@example.com' },
    });
  });

  it('returns 401 when a private route has no valid session', async () => {
    const app = createApi({ verifySession: async () => undefined });

    const response = await app.request('http://api.test/v1/me');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('serves an account-scoped freshness report only after session verification', async () => {
    const get = async (accountId: string, userId: string, token: string) => {
      expect([accountId, userId, token]).toEqual(['account-123', 'user-123', 'session-token']);
      return { expectedDate: '2026-07-06' as never, rows: [{ symbol: 'AAPL', expectedDate: '2026-07-06' as never, latestDate: null, status: 'missing' as const }] };
    };
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), priceFreshnessRepository: { get } });
    const response = await app.request('http://api.test/v1/accounts/account-123/price-freshness', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ report: { expectedDate: '2026-07-06', rows: [{ symbol: 'AAPL', expectedDate: '2026-07-06', latestDate: null, status: 'missing' }] } });
  });

  it('serves the latest persisted report snapshot through the authenticated route', async () => {
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), reportSnapshotReader: { getLatest: async (accountId, token) => { expect(accountId).toBe('account-123'); expect(token).toBe('session-token'); return { id: '11111111-1111-4111-8111-111111111111', userId: 'user-123', accountId: 'account-123', reportType: 'account_daily', asOfDate: '2026-07-06', importStateRevision: 'rev-1', priceRevisionId: null, payload: { totalValue: '100' }, publishedAt: '2026-07-06T23:00:00Z' }; } } });
    const response = await app.request('http://api.test/v1/accounts/account-123/report', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ snapshot: { asOfDate: '2026-07-06', payload: { totalValue: '100' } } });
  });

  it('serves paginated account activity with source-row detail after ownership verification', async () => {
    const list = async (accountId: string, token: string, input?: { limit?: number; offset?: number }) => {
      expect([accountId, token, input]).toEqual(['account-123', 'session-token', { limit: 10, offset: 20 }]);
      return { items: [], limit: 10, offset: 20, hasMore: false };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => ({ id: 'account-123' } as never), create: async () => { throw new Error('unused'); } },
      activityRepository: { list },
    });
    const response = await app.request('http://api.test/v1/accounts/account-123/activity?limit=10&offset=20', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activity: { items: [], limit: 10, offset: 20, hasMore: false } });
  });

  it('exports account activity as formula-safe CSV', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => ({ id: 'account-123' } as never), create: async () => { throw new Error('unused'); } },
      activityRepository: { list: async () => ({ items: [{ id: '11111111-1111-4111-8111-111111111111', accountId: 'account-123', effectiveDate: '2026-01-01', entryType: 'deposit', instrumentId: null, quantity: null, unitPrice: null, cashAmount: '25', externalFlow: true, description: '=formula', sourceRowId: null, sourceRow: null }], limit: 100, offset: 0, hasMore: false }) },
    });
    const response = await app.request('http://api.test/v1/accounts/account-123/activity.csv', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    await expect(response.text()).resolves.toContain("'=formula");
  });

  it('walks every activity page for a complete export', async () => {
    const calls: Array<{ limit?: number; offset?: number }> = [];
    const activity = (id: string, description: string) => ({ id, accountId: 'account-123', effectiveDate: '2026-01-01', entryType: 'buy', instrumentId: 'instrument-123', quantity: '1', unitPrice: '10', cashAmount: '-10', externalFlow: false, description, sourceRowId: null, sourceRow: null });
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => ({ id: 'account-123' } as never), create: async () => { throw new Error('unused'); } },
      activityRepository: { list: async (_accountId, _token, input) => {
        calls.push(input ?? {});
        if (input?.offset === 0) return { items: [activity('11111111-1111-4111-8111-111111111111', 'first')], limit: 100, offset: 0, hasMore: true };
        return { items: [activity('22222222-2222-4222-8222-222222222222', '+second')], limit: 100, offset: 1, hasMore: false };
      } },
    });
    const response = await app.request('http://api.test/v1/accounts/account-123/activity.csv', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }]);
    const csv = await response.text();
    expect(csv).toContain('buy,instrument-123');
    expect(csv).toContain("'+second");
    expect(csv.match(/buy,instrument-123/g)).toHaveLength(2);
  });

  it('exports an owned persisted report as a rectangular CSV', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => ({ id: 'account-123' } as never), create: async () => { throw new Error('unused'); } },
      reportSnapshotReader: { getLatest: async () => ({ id: 'snapshot-123', userId: 'user-123', accountId: 'account-123', reportType: 'account_daily', asOfDate: '2026-07-06', importStateRevision: 'rev-1', priceRevisionId: null, publishedAt: '2026-07-06T23:00:00Z', payload: { totalValue: '100', cash: '20', timeWeightedReturn: '0.1', activityCoveredThrough: '2026-07-05', pricesThrough: '2026-07-06', holdings: [{ instrumentId: 'AAPL', quantity: '1', close: '80', value: '80' }] } }) },
    });
    const response = await app.request('http://api.test/v1/accounts/account-123/report.csv', { headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('portfolio-report-account-123.csv');
    await expect(response.text()).resolves.toContain('holding,AAPL');
  });

  it('keeps account deletion request unavailable until a durable executor is configured', async () => {
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }) });
    const response = await app.request('http://api.test/v1/me/deletion-request', { method: 'POST', headers: { authorization: 'Bearer session-token' } });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'deletion_unavailable' });
  });

  it('lists accounts only after verifying the caller and carries the same token into the RLS repository', async () => {
    const list = async (userId: string, token: string) => {
      expect(userId).toBe('user-123');
      expect(token).toBe('session-token');
      return [];
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list, get: async () => undefined, create: async () => { throw new Error('unused'); } },
    });

    const response = await app.request('http://api.test/v1/accounts', { headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accounts: [] });
  });

  it('creates only a supported Robinhood account for the verified user', async () => {
    const create = async (userId: string, token: string, input: { accountType: 'individual' | 'traditional_ira' | 'roth_ira'; name: string }) => {
      expect(userId).toBe('user-123');
      expect(token).toBe('session-token');
      expect(input).toEqual({ accountType: 'roth_ira', name: 'Future me' });
      return { id: 'account-123', userId, brokerage: 'robinhood' as const, accountType: input.accountType, name: input.name, currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => undefined, create },
    });

    const response = await app.request('http://api.test/v1/accounts', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ accountType: 'roth_ira', name: '  Future me  ' }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ account: { id: 'account-123', accountType: 'roth_ira' } });
  });

  it('reads and saves owned opening history through the authenticated API', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    let saved: unknown;
    const history = parseOpeningHistory({ openingCash: '125.5', activityCoveredFrom: null, incompleteReason: 'History begins after account opening.', positions: [{ instrumentId: 'vti', quantity: '2.5', acquiredOn: null, totalCostBasis: null }] });
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), accountsRepository: { list: async () => [], get: async () => account, create: async () => account }, openingHistoryRepository: { get: async (accountId, userId, token) => { expect([accountId, userId, token]).toEqual([account.id, 'user-123', 'session-token']); return history; }, save: async (accountId, userId, token, value) => { expect([accountId, userId, token]).toEqual([account.id, 'user-123', 'session-token']); saved = value; return value; } } });
    const headers = { authorization: 'Bearer session-token', 'content-type': 'application/json' };
    const read = await app.request(`http://api.test/v1/accounts/${account.id}/opening-history`, { headers });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ history });
    const write = await app.request(`http://api.test/v1/accounts/${account.id}/opening-history`, { method: 'PUT', headers, body: JSON.stringify(history) });
    expect(write.status).toBe(200);
    expect(saved).toEqual(history);
  });

  it('rejects incomplete opening history without an explanation', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), accountsRepository: { list: async () => [], get: async () => account, create: async () => account }, openingHistoryRepository: { get: async () => undefined, save: async () => { throw new Error('must not save'); } } });
    const response = await app.request(`http://api.test/v1/accounts/${account.id}/opening-history`, { method: 'PUT', headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' }, body: JSON.stringify({ openingCash: '0', activityCoveredFrom: null, incompleteReason: null, positions: [{ instrumentId: 'vti', quantity: '1', acquiredOn: null, totalCostBasis: null }] }) });
    expect(response.status).toBe(400);
  });

  it('parses a CSV only after the verified user owns the selected account, then checks its hash', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    const hasFileHash = async (accountId: string, token: string, hash: string) => {
      expect(accountId).toBe(account.id);
      expect(token).toBe('session-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      return false;
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => account, create: async () => account },
      importsRepository: { hasFileHash, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request(`http://api.test/v1/accounts/${account.id}/import-preview`, {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'text/csv' },
      body: 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { accountId: account.id, duplicateFile: false, review: { acceptedRowCount: 1 } } });
  });

  it('does not preview an import for an account that RLS did not return', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => undefined, create: async () => { throw new Error('unused'); } },
      importsRepository: { hasFileHash: async () => { throw new Error('must not query imports'); }, stage: async () => { throw new Error('must not stage imports'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/accounts/another-user-account/import-preview', { method: 'POST', headers: { authorization: 'Bearer session-token', 'content-type': 'text/csv' }, body: 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2' });

    expect(response.status).toBe(404);
  });

  it('stages owned CSV rows through the atomic repository after duplicate-file preflight', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    const stage = async (token: string, input: { fileName: string; accountId: string }) => {
      expect(token).toBe('session-token');
      expect(input).toMatchObject({ fileName: 'activity.csv', accountId: account.id });
      return { id: 'import-123', status: 'ready_for_review' as const };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => account, create: async () => account },
      importsRepository: { hasFileHash: async () => false, stage, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request(`http://api.test/v1/accounts/${account.id}/imports`, {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'text/csv', 'x-file-name': 'activity.csv' },
      body: 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123', status: 'ready_for_review', review: { acceptedRowCount: 1 } } });
  });

  it('rejects an identical file before it reaches the staging RPC', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => account, create: async () => account },
      importsRepository: { hasFileHash: async () => true, stage: async () => { throw new Error('must not stage duplicate'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request(`http://api.test/v1/accounts/${account.id}/imports`, { method: 'POST', headers: { authorization: 'Bearer session-token', 'content-type': 'text/csv', 'x-file-name': 'activity.csv' }, body: 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2' });

    expect(response.status).toBe(409);
  });

  it('lists an account import history only after account ownership is confirmed', async () => {
    const account = { id: 'account-123', userId: 'user-123', brokerage: 'robinhood' as const, accountType: 'individual' as const, name: 'Taxable', currency: 'USD' as const, activityCoveredThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    const list = async (accountId: string, token: string) => {
      expect(accountId).toBe(account.id);
      expect(token).toBe('session-token');
      return [{ id: 'import-123', accountId, status: 'ready_for_review' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: null, activityThrough: null, createdAt: '2026-09-09T00:00:00.000Z' }];
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      accountsRepository: { list: async () => [], get: async () => account, create: async () => account },
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list, get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request(`http://api.test/v1/accounts/${account.id}/imports`, { headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ imports: [{ id: 'import-123', status: 'ready_for_review' }] });
  });

  it('discards an RLS-authorized review import without deleting it', async () => {
    const discard = async (importId: string, token: string) => {
      expect(importId).toBe('import-123');
      expect(token).toBe('session-token');
      return { id: importId, accountId: 'account-123', status: 'discarded' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: null, activityThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/discard', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123', status: 'discarded' } });
  });

  it('commits a reviewed import through the authenticated repository', async () => {
    const commit = async (importId: string, token: string) => {
      expect(importId).toBe('import-123');
      expect(token).toBe('session-token');
      return { id: importId, accountId: 'account-123', status: 'committed' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: '2026-01-02', activityThrough: '2026-01-02', createdAt: '2026-09-09T00:00:00.000Z' };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/commit', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123', status: 'committed' } });
  });

  it('does not claim an unavailable or already-committed import was committed', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/commit', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found_or_not_committable' });
  });

  it('reports stored review issues as a resolvable conflict', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => { throw new ImportOperationRejectedError(); }, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/commit', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'review_issues_must_be_resolved' });
  });

  it('undoes the latest committed import through the authenticated repository', async () => {
    const undo = async (importId: string, token: string) => {
      expect(importId).toBe('import-123');
      expect(token).toBe('session-token');
      return { id: importId, accountId: 'account-123', status: 'undone' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: null, activityThrough: null, createdAt: '2026-09-09T00:00:00.000Z' };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/undo', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123', status: 'undone' } });
  });

  it('requires imports to be undone in reverse commit order', async () => {
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined, commit: async () => undefined, undo: async () => { throw new ImportOperationRejectedError(); } },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/undo', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'only_the_latest_committed_import_can_be_undone' });
  });

  it('returns persisted review rows through the RLS-scoped import repository', async () => {
    const get = async (importId: string, token: string) => {
      expect(importId).toBe('import-123');
      expect(token).toBe('session-token');
      return { import: { id: importId, accountId: 'account-123', status: 'ready_for_review' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: null, activityThrough: null, createdAt: '2026-09-09T00:00:00.000Z' }, sourceRows: [{ id: 'row-123', rowNumber: 2, raw: { amount: '$2' }, normalizedPayload: { type: 'interest' }, status: 'supported' as const, message: null }] };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get, discard: async () => undefined, commit: async () => undefined, undo: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123', { headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123' }, sourceRows: [{ status: 'supported' }] });
  });

  it('creates a signed upload URL only for the authenticated account', async () => {
    const create = async (userId: string, token: string, accountId: string, fileName: string) => {
      expect([userId, token, accountId, fileName]).toEqual(['user-123', 'session-token', 'account-123', 'activity.csv']);
      return { bucket: 'brokerage-statements' as const, path: 'user-123/account-123/upload.csv', token: 'upload-token', signedUrl: 'https://storage.test/upload' };
    };
    const app = createApi({ verifySession: async () => ({ id: 'user-123' }), signedUploadRepository: { create } });
    const response = await app.request('http://api.test/v1/accounts/account-123/upload-url', { method: 'POST', headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'activity.csv' }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ upload: { bucket: 'brokerage-statements', path: 'user-123/account-123/upload.csv', token: 'upload-token', signedUrl: 'https://storage.test/upload' } });
  });
});
