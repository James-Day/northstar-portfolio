import { describe, expect, it, vi } from 'vitest';
import {
  SessionConfigurationError,
  verifySupabaseSession,
} from '@/services/auth/server-session';

const config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'public-anon-key',
};

describe('Supabase server-session verifier', () => {
  it('does not make a request without a bearer token', async () => {
    const requestFetch = vi.fn();
    await expect(verifySupabaseSession(new Request('https://api.test/v1/me'), config, requestFetch)).resolves.toBeUndefined();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('returns only a validated user from Supabase', async () => {
    const requestFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-123', email: 'person@example.com', role: 'authenticated' })),
    );

    await expect(
      verifySupabaseSession(
        new Request('https://api.test/v1/me', { headers: { authorization: 'Bearer session-token' } }),
        config,
        requestFetch,
      ),
    ).resolves.toEqual({ id: 'user-123', email: 'person@example.com' });

    expect(requestFetch).toHaveBeenCalledWith(
      new URL('https://project.supabase.co/auth/v1/user'),
      expect.objectContaining({
        headers: { apikey: 'public-anon-key', authorization: 'Bearer session-token' },
      }),
    );
  });

  it('rejects invalid sessions and missing server configuration', async () => {
    await expect(
      verifySupabaseSession(
        new Request('https://api.test/v1/me', { headers: { authorization: 'Bearer expired' } }),
        config,
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      ),
    ).resolves.toBeUndefined();

    await expect(
      verifySupabaseSession(
        new Request('https://api.test/v1/me', { headers: { authorization: 'Bearer valid' } }),
        {},
      ),
    ).rejects.toBeInstanceOf(SessionConfigurationError);
  });
});
