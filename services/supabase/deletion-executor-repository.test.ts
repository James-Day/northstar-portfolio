import { describe, expect, it, vi } from 'vitest';
import { SupabaseDeletionExecutorRepository } from './deletion-executor-repository';

const response = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });

describe('Supabase deletion executor repository', () => {
  it('claims and maps worker plan items through the service role RPC', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ id: '11111111-1111-4111-8111-111111111111', request_id: '22222222-2222-4222-8222-222222222222', user_id: '33333333-3333-4333-8333-333333333333', target_type: 'account', target_id: '44444444-4444-4444-8444-444444444444', target_path: null, attempts: 2 }]));
    const repository = new SupabaseDeletionExecutorRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.claim(10, new Date('2026-01-01T00:00:00Z'), 8)).resolves.toEqual([{ id: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333', targetType: 'account', targetId: '44444444-4444-4444-8444-444444444444', targetPath: null, attempt: 2 }]);
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/claim_user_deletion_plan_items');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ apikey: 'service-secret', authorization: 'Bearer service-secret' });
  });

  it('maps idempotent completion and retry outcomes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{ outcome: 'retrying' }]));
    const repository = new SupabaseDeletionExecutorRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher: fetcher as typeof fetch });
    await expect(repository.complete('11111111-1111-4111-8111-111111111111', new Date('2026-01-01T00:00:00Z'), 2)).resolves.toBeUndefined();
    await expect(repository.fail('11111111-1111-4111-8111-111111111111', { failedAt: new Date('2026-01-01T00:00:00Z'), retryAt: new Date('2026-01-01T00:00:05Z'), error: 'temporary', maxAttempts: 8, attempt: 2 })).resolves.toBe('retrying');
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/complete_user_deletion_plan_item');
    expect(String(fetcher.mock.calls[1][0])).toContain('/rpc/fail_user_deletion_plan_item');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ p_attempts: 2 });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ p_attempts: 2 });
  });
});
