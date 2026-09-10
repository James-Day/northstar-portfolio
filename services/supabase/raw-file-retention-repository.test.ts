import { describe, expect, it, vi } from 'vitest';
import { SupabasePrivateObjectStore, SupabaseRawFileRetentionRepository } from '@/services/supabase/raw-file-retention-repository';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const options = { supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret' };

describe('SupabaseRawFileRetentionRepository', () => {
  it('maps service-role claims and records durable outcomes through RPCs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([{ id: '11111111-1111-4111-8111-111111111111', import_id: '22222222-2222-4222-8222-222222222222', object_path: 'user/account/a.csv', uploaded_at: '2026-01-01T00:00:00.000Z', deleted_at: null, attempts: 2 }]))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response('retrying'));
    const repository = new SupabaseRawFileRetentionRepository({ ...options, fetcher: fetcher as typeof fetch });
    await expect(repository.claim(new Date('2026-02-01T00:00:00Z'), 100, 8)).resolves.toMatchObject([{ id: '11111111-1111-4111-8111-111111111111', importId: '22222222-2222-4222-8222-222222222222', attempt: 2 }]);
    await repository.markDeleted('11111111-1111-4111-8111-111111111111', new Date('2026-02-01T00:00:00Z'));
    await expect(repository.markFailure('11111111-1111-4111-8111-111111111111', { at: new Date(), retryAt: new Date(), error: 'retry', maxAttempts: 8 })).resolves.toBe('retrying');
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/claim_raw_file_retention');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer service-secret' });
  });
});

describe('SupabasePrivateObjectStore', () => {
  it('treats a missing object as an idempotent delete and verifies 404', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(null, 404)).mockResolvedValueOnce(response(null, 404));
    const store = new SupabasePrivateObjectStore({ ...options, fetcher: fetcher as typeof fetch });
    await store.delete('user/account/a.csv');
    await expect(store.verifyDeleted('user/account/a.csv')).resolves.toBe(true);
    expect(String(fetcher.mock.calls[0][0])).toContain('/storage/v1/object/remove/brokerage-statements');
    expect(String(fetcher.mock.calls[1][0])).toContain('/storage/v1/object/brokerage-statements/user/account/a.csv');
  });

  it('rejects traversal paths before making a storage request', async () => {
    const fetcher = vi.fn();
    const store = new SupabasePrivateObjectStore({ ...options, fetcher: fetcher as typeof fetch });
    await expect(store.delete('../private.csv')).rejects.toThrow('invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
