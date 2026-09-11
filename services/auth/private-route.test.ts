import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
const redirectMock = vi.hoisted(() => vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => cookie.value ? { value: cookie.value } : undefined })) }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import { requirePrivateSession } from '@/services/auth/private-route';

describe('private page route gate', () => {
  beforeEach(() => { cookie.value = undefined; redirectMock.mockClear(); });

  it('redirects before rendering when no private session handoff exists', async () => {
    await expect(requirePrivateSession({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon' })).rejects.toThrow('REDIRECT:/sign-in?next=/dashboard');
  });

  it('verifies the HttpOnly handoff token before allowing page rendering', async () => {
    cookie.value = 'access-token-that-is-long-enough';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'user-1', email: 'user@example.com' }), { status: 200 }));
    await expect(requirePrivateSession({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon' })).resolves.toEqual({ id: 'user-1', email: 'user@example.com' });
    expect(fetcher).toHaveBeenCalledWith(new URL('https://supabase.test/auth/v1/user'), expect.objectContaining({ headers: { apikey: 'anon', authorization: 'Bearer access-token-that-is-long-enough' } }));
    fetcher.mockRestore();
  });

  it('redirects invalid or expired handoffs instead of rendering private UI', async () => {
    cookie.value = 'expired-access-token-that-is-long-enough';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(requirePrivateSession({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon' })).rejects.toThrow('REDIRECT:/sign-in?next=/dashboard');
    fetcher.mockRestore();
  });

  it('fails closed when session verification itself fails', async () => {
    cookie.value = 'access-token-that-is-long-enough';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Supabase unavailable'));
    await expect(requirePrivateSession({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon' })).rejects.toThrow('REDIRECT:/sign-in?next=/dashboard');
    fetcher.mockRestore();
  });
});
