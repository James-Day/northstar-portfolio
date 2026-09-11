import { describe, expect, it, vi } from 'vitest';
import {
  createLocalIntegrationUsers,
  deleteLocalIntegrationUsers,
  parseSupabaseStatusEnv,
} from './local-supabase-fixtures';

describe('local Supabase integration fixtures', () => {
  it('parses status credentials without requiring a particular CLI quoting style', () => {
    expect(parseSupabaseStatusEnv("API_URL='http://127.0.0.1:54321'\nANON_KEY=anon\nSERVICE_ROLE_KEY=service\n")).toEqual({
      apiUrl: 'http://127.0.0.1:54321',
      anonKey: 'anon',
      serviceRoleKey: 'service',
    });
  });

  it('rejects incomplete status output', () => {
    expect(() => parseSupabaseStatusEnv('API_URL=http://localhost\nANON_KEY=anon')).toThrow('SERVICE_ROLE_KEY');
  });

  it('creates two deterministic users and retains tokens only in the returned memory object', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-a' }, access_token: 'token-a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-b' }, access_token: 'token-b' }), { status: 200 }));
    const users = await createLocalIntegrationUsers({ apiUrl: 'http://localhost:54321', anonKey: 'anon' }, fetcher);
    expect(users.map(({ label, email, userId }) => ({ label, email, userId }))).toEqual([
      { label: 'a', email: 'portfolio-integration-a@example.test', userId: 'user-a' },
      { label: 'b', email: 'portfolio-integration-b@example.test', userId: 'user-b' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ email: 'portfolio-integration-a@example.test', password: 'local-integration-a-2026-only' });
  });

  it('deletes only the users created by the run and tolerates already-cleaned users', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await deleteLocalIntegrationUsers({ apiUrl: 'http://localhost:54321', serviceRoleKey: 'service' }, [{ userId: 'user-a' }, { userId: 'user-b' }], fetcher);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://localhost:54321/auth/v1/admin/users/user-b',
      'http://localhost:54321/auth/v1/admin/users/user-a',
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'DELETE', headers: { authorization: 'Bearer service' } });
  });
});
