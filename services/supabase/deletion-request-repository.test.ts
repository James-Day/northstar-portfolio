import { describe, expect, it, vi } from 'vitest';
import { SupabaseDeletionRequestRepository } from './deletion-request-repository';

describe('SupabaseDeletionRequestRepository', () => {
  it('calls the authenticated idempotent deletion RPC and maps its result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      status: 'requested',
      requested_at: '2026-09-10T18:00:00Z',
      completed_at: null,
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    const repository = new SupabaseDeletionRequestRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon', fetcher });

    await expect(repository.request('22222222-2222-4222-8222-222222222222', 'session-token')).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', status: 'requested', requestedAt: '2026-09-10T18:00:00Z', completedAt: null,
    });
    const [input, init] = fetcher.mock.calls[0];
    expect(String(input)).toContain('/rest/v1/rpc/request_user_data_deletion');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer session-token');
    expect(init?.body).toBe('{}');
  });

  it('rejects a response belonging to a different user', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{
      id: '11111111-1111-4111-8111-111111111111', user_id: '33333333-3333-4333-8333-333333333333', status: 'requested', requested_at: '2026-09-10T18:00:00Z', completed_at: null,
    }])));
    const repository = new SupabaseDeletionRequestRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon', fetcher });
    await expect(repository.request('22222222-2222-4222-8222-222222222222', 'session-token')).rejects.toThrow('another user');
  });

  it('surfaces failed RPC responses and validates credentials', async () => {
    const repository = new SupabaseDeletionRequestRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon', fetcher: vi.fn() });
    await expect(repository.request('', 'token')).rejects.toThrow('user ID');
    await expect(repository.request('22222222-2222-4222-8222-222222222222', '')).rejects.toThrow('access token');
    const failed = new SupabaseDeletionRequestRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon', fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })) });
    await expect(failed.request('22222222-2222-4222-8222-222222222222', 'token')).rejects.toThrow('HTTP 500');
  });
});
