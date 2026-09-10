import { describe, expect, it, vi } from 'vitest';
import { SupabaseImportJobRepository } from './import-job-repository';

function response(value: unknown, ok = true) { return { ok, status: ok ? 200 : 500, json: vi.fn().mockResolvedValue(value) } as unknown as Response; }

describe('Supabase import job repository', () => {
  it('maps a claimed lease and sends service-role RPC calls', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ import_id: '550e8400-e29b-41d4-a716-446655440000', account_id: '550e8400-e29b-41d4-a716-446655440001', attempt: 1, total_rows: 12, progress_rows: 0 }))
      .mockResolvedValueOnce(response(null));
    const repository = new SupabaseImportJobRepository({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'service-key', fetcher });
    const lease = await repository.claim({ kind: 'import.process', importId: '550e8400-e29b-41d4-a716-446655440000', accountId: '550e8400-e29b-41d4-a716-446655440001', requestedBy: '550e8400-e29b-41d4-a716-446655440002' });
    expect(lease).toMatchObject({ importId: '550e8400-e29b-41d4-a716-446655440000', totalRows: 12 });
    await repository.progress(lease as Exclude<typeof lease, undefined | { state: 'already_complete' }>, 5);
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/claim_import_processing');
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({ p_progress_rows: 5 });
  });

  it('preserves already-complete and dead-letter outcomes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ state: 'already_complete' })).mockResolvedValueOnce(response('dead_lettered'));
    const repository = new SupabaseImportJobRepository({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'service-key', fetcher });
    const job = { kind: 'import.process' as const, importId: '550e8400-e29b-41d4-a716-446655440000', accountId: '550e8400-e29b-41d4-a716-446655440001', requestedBy: '550e8400-e29b-41d4-a716-446655440002' };
    await expect(repository.claim(job)).resolves.toEqual({ state: 'already_complete' });
    await expect(repository.fail({ importId: job.importId, accountId: job.accountId, attempt: 1, totalRows: 1, progressRows: 0 }, 'bad')).resolves.toBe('dead_lettered');
  });
});
