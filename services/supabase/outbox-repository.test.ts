import { describe, expect, it, vi } from 'vitest';
import { SupabaseOutboxRepository } from './outbox-repository';

function response(body: unknown, ok = true) { return { ok, status: ok ? 200 : 500, json: vi.fn().mockResolvedValue(body) } as unknown as Response; }
describe('Supabase outbox repository', () => {
  it('maps claim RPC rows to provider-neutral events', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ id: '550e8400-e29b-41d4-a716-446655440000', event_type: 'import.committed', payload: { accountId: 'a' }, attempts: 1 }]));
    const repo = new SupabaseOutboxRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher: fetcher as typeof fetch });
    await expect(repo.claim(10, '2026-09-10T20:00:00.000Z')).resolves.toEqual([{ id: '550e8400-e29b-41d4-a716-446655440000', eventType: 'import.committed', payload: { accountId: 'a' }, attempts: 1 }]);
    expect(String(fetcher.mock.calls[0][0])).toContain('/rest/v1/rpc/claim_job_outbox');
  });
  it('uses worker RPCs for completion and retry state', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response('retrying'));
    const repo = new SupabaseOutboxRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher: fetcher as typeof fetch });
    await repo.complete('550e8400-e29b-41d4-a716-446655440000');
    await expect(repo.fail('550e8400-e29b-41d4-a716-446655440000', { retryAt: '2026-09-10T20:01:00.000Z', error: 'down', maxAttempts: 8 })).resolves.toBe('retrying');
    expect(String(fetcher.mock.calls[0][0])).toContain('/complete_job_outbox');
    expect(String(fetcher.mock.calls[1][0])).toContain('/fail_job_outbox');
  });
});
