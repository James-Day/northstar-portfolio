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
      importsRepository: { hasFileHash },
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
      importsRepository: { hasFileHash: async () => { throw new Error('must not query imports'); } },
    });

    const response = await app.request('http://api.test/v1/accounts/another-user-account/import-preview', { method: 'POST', headers: { authorization: 'Bearer session-token', 'content-type': 'text/csv' }, body: 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2' });

    expect(response.status).toBe(404);
  });
});
