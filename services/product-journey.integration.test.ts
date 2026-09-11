import { describe, expect, it, vi } from 'vitest';
import { createApi } from '@/services/api/app';
import type { PortfolioAccount, AccountsRepository } from '@/services/accounts/accounts';
import type { ImportsRepository, ImportReviewDetail, ImportSummary, ImportSourceRow } from '@/services/supabase/imports-repository';
import type { ImportIssueRepository } from '@/services/supabase/import-issue-repository';
import type { Entitlement } from '@/services/billing/entitlements';
import type { BillingPersistence } from '@/services/billing/persistence';
import type { ReportSnapshot } from '@/services/supabase/report-snapshot-reader';
import type { PersistableImportStage } from '@/services/ingestion/staging';

const userId = '11111111-1111-4111-8111-111111111111';
const token = 'integration-session';
const csv = [
  'Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description',
  '2026-01-02,BUY,AAPL,2,100,200,Initial purchase',
  '2026-01-03,OTHER,AAPL,0,,0,Unsupported informational row',
].join('\n');

const trial = (): Entitlement => ({
  status: 'trialing',
  trialStartedAt: new Date('2026-01-03T00:00:00Z'),
  trialEndsAt: new Date('2099-01-17T00:00:00Z'),
  processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null,
});

function buildJourney() {
  const accounts: PortfolioAccount[] = [];
  const imports = new Map<string, { record: ImportSummary; detail: ImportReviewDetail; stage: PersistableImportStage }>();
  const resolutions = new Map<string, Awaited<ReturnType<ImportIssueRepository['list']>>>();
  let nextAccount = 0;
  let nextImport = 0;
  let entitlement: Entitlement = { ...trial(), status: 'inactive', trialStartedAt: null, trialEndsAt: null };
  const accountRepo: AccountsRepository = {
    list: async (owner) => accounts.filter((account) => account.userId === owner),
    get: async (owner, _access, id) => accounts.find((account) => account.id === id && account.userId === owner),
    create: async (owner, _access, input) => {
      const account: PortfolioAccount = { id: `account-${++nextAccount}`, userId: owner, brokerage: 'robinhood', accountType: input.accountType, name: input.name, currency: 'USD', activityCoveredThrough: null, createdAt: '2026-01-01T00:00:00.000Z' };
      accounts.push(account); return account;
    },
  };
  const importRepo: ImportsRepository = {
    hasFileHash: async (accountId, _access, hash) => [...imports.values()].some((item) => item.record.accountId === accountId && item.stage.fileSha256 === hash && !['discarded', 'undone'].includes(item.record.status)),
    stage: async (_access, stage) => {
      const id = `import-${++nextImport}`;
      const record: ImportSummary = { id, accountId: stage.accountId, status: 'ready_for_review', fileName: stage.fileName, sourceRowCount: stage.rows.length, usableRowCount: stage.usableRowCount, warningCount: stage.warningCount, activityFrom: stage.activityFrom, activityThrough: stage.activityThrough, createdAt: '2026-01-03T00:00:00.000Z', committedAt: null };
      const sourceRows: ImportSourceRow[] = stage.rows.map((row, index) => ({ id: `${id}-row-${index + 1}`, rowNumber: row.rowNumber, raw: row.raw, normalizedPayload: row.activity ?? null, status: row.status, message: row.message ?? null }));
      const detail = { import: record, sourceRows };
      imports.set(id, { record, detail, stage });
      return { id, status: 'ready_for_review' };
    },
    list: async (accountId) => [...imports.values()].map((item) => item.record).filter((record) => record.accountId === accountId),
    get: async (id) => imports.get(id)?.detail,
    discard: async (id) => { const item = imports.get(id); if (!item) return undefined; item.record.status = 'discarded'; return item.record; },
    commit: async (id) => {
      const item = imports.get(id); if (!item || item.record.status !== 'ready_for_review') return undefined;
      const issueRows = item.detail.sourceRows.filter((row) => row.status === 'unsupported' || row.status === 'invalid');
      const resolved = resolutions.get(id) ?? [];
      if (issueRows.some((row) => !resolved.some((resolution) => resolution.sourceRowId === row.id))) throw new Error('review issues');
      item.record.status = 'committed'; item.record.committedAt = '2026-01-03T00:00:00.000Z'; entitlement = trial(); return item.record;
    },
    undo: async (id) => { const item = imports.get(id); if (!item) return undefined; item.record.status = 'undone'; return item.record; },
  };
  const issueRepo: ImportIssueRepository = {
    list: async (id) => resolutions.get(id) ?? [],
    save: async (id, _access, input) => { const body = input as { sourceRowId: string; issueCode: 'unsupported_row'; resolutionKind: 'non_reportable'; note: string }; const resolution = { id: `${id}-resolution`, importId: id, sourceRowId: body.sourceRowId, issueCode: body.issueCode, resolutionKind: body.resolutionKind, note: body.note, resolvedBy: userId, resolvedAt: '2026-01-03T00:00:00.000Z' } as const; resolutions.set(id, [resolution]); return resolution; },
  };
  const snapshot: ReportSnapshot = { id: 'snapshot-1', userId, accountId: null, reportType: 'account_daily', asOfDate: '2026-01-03', importStateRevision: 'ledger:import-1', priceRevisionId: null, publishedAt: '2026-01-03T00:00:00.000Z', payload: { totalValue: '205', cash: '5', netDeposits: '200', dividendIncome: '0', realizedGainLoss: '0', holdings: [{ instrumentId: 'AAPL', displayName: 'Apple Inc.', quantity: '2', close: '102.50', value: '205' }] } };
  const billing: BillingPersistence = { getEntitlement: async () => entitlement, startTrialAfterCommittedImport: async () => entitlement, applyVerifiedWebhook: async () => entitlement };
  const checkout = vi.fn(async (input: { userId: string; accessToken: string; priceId: string; successUrl: string; cancelUrl: string }) => ({ url: `https://checkout.stripe.com/c/pay/${input.priceId}` }));
  const app = createApi({
    verifySession: async (request) => request.headers.get('authorization') === `Bearer ${token}` ? { id: userId, email: 'integration@example.test', accessToken: token } : undefined,
    accountsRepository: accountRepo, importsRepository: importRepo, importIssueRepository: issueRepo, billingPersistence: billing, now: () => Date.parse('2026-01-03T12:00:00.000Z'),
    reportSnapshotReader: { getLatest: async () => snapshot },
    billing: { createCheckoutSession: checkout, createBillingPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session' }), handleVerifiedWebhook: async () => undefined },
  });
  return { app, accountRepo, imports, resolutions, checkout };
}

async function json(response: Response) { return response.json() as Promise<Record<string, any>>; }

/**
 * Contract journey for the first usable product path. It uses injectable adapters
 * so it verifies API sequencing and ownership without pretending to be hosted
 * Supabase, Storage, Stripe, or a live browser run.
 */
describe('local product journey contract', () => {
  it.each([
    ['individual', 'Individual brokerage'],
    ['traditional_ira', 'Traditional IRA'],
  ] as const)('completes signup/session → %s account → Robinhood review → dashboard → trial → billing', async (accountType, accountName) => {
    const { app, imports, resolutions, checkout } = buildJourney();
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await json(await app.request('http://api.test/v1/me', { headers: auth }))).user.id).toBe(userId);
    const accountResponse = await app.request('http://api.test/v1/accounts', { method: 'POST', headers: auth, body: JSON.stringify({ accountType, name: accountName }) });
    expect(accountResponse.status).toBe(201);
    const account = (await json(accountResponse)).account as PortfolioAccount;
    const importResponse = await app.request(`http://api.test/v1/accounts/${account.id}/imports`, { method: 'POST', headers: { ...auth, 'content-type': 'text/csv', 'x-file-name': `${accountType}.csv` }, body: csv });
    expect(importResponse.status).toBe(201);
    const staged = (await json(importResponse)).import as { id: string; review: { materialUnsupportedRowCount: number } };
    expect(staged.review.materialUnsupportedRowCount).toBe(1);
    const review = await json(await app.request(`http://api.test/v1/imports/${staged.id}`, { headers: auth }));
    const issueRow = review.sourceRows.find((row: ImportSourceRow) => row.status === 'unsupported');
    expect(issueRow).toBeTruthy();
    const resolution = await app.request(`http://api.test/v1/imports/${staged.id}/issues`, { method: 'PUT', headers: auth, body: JSON.stringify({ sourceRowId: issueRow!.id, issueCode: 'unsupported_row', resolutionKind: 'non_reportable', note: 'Informational row excluded from reporting.' }) });
    expect(resolution.status).toBe(201);
    expect(resolutions.get(staged.id)).toHaveLength(1);
    const commit = await app.request(`http://api.test/v1/imports/${staged.id}/commit`, { method: 'POST', headers: auth });
    expect(commit.status).toBe(200);
    expect((await json(commit)).import.status).toBe('committed');
    expect([...imports.values()][0].record.status).toBe('committed');
    const report = await app.request(`http://api.test/v1/accounts/${account.id}/report`, { headers: auth });
    expect(report.status).toBe(200);
    expect((await json(report)).snapshot.payload.totalValue).toBe('205');
    const status = await app.request('http://api.test/v1/billing/status', { headers: auth });
    expect((await json(status)).access).toMatchObject({ allowed: true, reason: 'trialing' });
    const billingResponse = await app.request('http://api.test/v1/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'monthly' }) }, { APP_ORIGIN: 'https://northstar.example', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_ANNUAL_PRICE_ID: 'price_annual' });
    expect(billingResponse.status).toBe(200);
    expect((await json(billingResponse)).url).toContain('price_monthly');
    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ userId, accessToken: token, priceId: 'price_monthly' }));
  });
});











