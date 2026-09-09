import { describe, expect, it } from 'vitest';
import { createApi } from '@/services/api/app';

describe('standalone API', () => {
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
      importsRepository: { hasFileHash, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard: async () => undefined },
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
      importsRepository: { hasFileHash: async () => { throw new Error('must not query imports'); }, stage: async () => { throw new Error('must not stage imports'); }, list: async () => [], get: async () => undefined, discard: async () => undefined },
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
      importsRepository: { hasFileHash: async () => false, stage, list: async () => [], get: async () => undefined, discard: async () => undefined },
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
      importsRepository: { hasFileHash: async () => true, stage: async () => { throw new Error('must not stage duplicate'); }, list: async () => [], get: async () => undefined, discard: async () => undefined },
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
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list, get: async () => undefined, discard: async () => undefined },
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
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get: async () => undefined, discard },
    });

    const response = await app.request('http://api.test/v1/imports/import-123/discard', { method: 'POST', headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123', status: 'discarded' } });
  });

  it('returns persisted review rows through the RLS-scoped import repository', async () => {
    const get = async (importId: string, token: string) => {
      expect(importId).toBe('import-123');
      expect(token).toBe('session-token');
      return { import: { id: importId, accountId: 'account-123', status: 'ready_for_review' as const, fileName: 'activity.csv', sourceRowCount: 1, usableRowCount: 1, warningCount: 0, activityFrom: null, activityThrough: null, createdAt: '2026-09-09T00:00:00.000Z' }, sourceRows: [{ id: 'row-123', rowNumber: 2, raw: { amount: '$2' }, normalizedPayload: { type: 'interest' }, status: 'supported' as const, message: null }] };
    };
    const app = createApi({
      verifySession: async () => ({ id: 'user-123' }),
      importsRepository: { hasFileHash: async () => false, stage: async () => { throw new Error('unused'); }, list: async () => [], get, discard: async () => undefined },
    });

    const response = await app.request('http://api.test/v1/imports/import-123', { headers: { authorization: 'Bearer session-token' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ import: { id: 'import-123' }, sourceRows: [{ status: 'supported' }] });
  });
});
