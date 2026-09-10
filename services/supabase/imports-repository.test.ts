import { describe, expect, it, vi } from 'vitest';
import { ImportOperationRejectedError, SupabaseImportsRepository } from '@/services/supabase/imports-repository';
import { stageRobinhoodImport, toPersistableImportStage } from '@/services/ingestion/staging';

describe('Supabase imports repository', () => {
  const summary = { id: 'import-id', account_id: 'account-id', status: 'ready_for_review', file_name: 'activity.csv', source_row_count: 1, usable_row_count: 1, warning_count: 0, activity_from: '2026-01-02', activity_through: '2026-01-02', created_at: '2026-09-09T12:00:00.000Z' };
  it('looks up only the selected account and file hash through the caller token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'import-id' }])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.hasFileHash('account-id', 'user-token', 'a'.repeat(64))).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.searchParams.get('account_id')).toBe('eq.account-id');
    expect(url.searchParams.get('file_sha256')).toBe(`eq.${'a'.repeat(64)}`);
    expect(url.searchParams.get('status')).toBe('not.in.(discarded,undone)');
    expect(init.headers).toMatchObject({ authorization: 'Bearer user-token' });
  });

  it('uses the staging RPC to persist raw rows and normalized review payloads atomically', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify('import-id')));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });
    const staged = toPersistableImportStage(await stageRobinhoodImport('account-id', 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2'), 'activity.csv');

    await expect(repository.stage('user-token', staged)).resolves.toEqual({ id: 'import-id', status: 'ready_for_review' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe('/rest/v1/rpc/stage_import');
    expect(init.headers).toMatchObject({ authorization: 'Bearer user-token' });
    expect(JSON.parse(init.body)).toMatchObject({ p_account_id: 'account-id', p_file_name: 'activity.csv', p_source_rows: [{ status: 'supported' }] });
  });

  it('converges on the existing review when concurrent staging loses the unique-index race', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '23505' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'existing-import' }])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });
    const staged = toPersistableImportStage(await stageRobinhoodImport('account-id', 'Activity Date,Trans Code,Amount\n2026-01-02,Interest,$2'), 'activity.csv');

    await expect(repository.stage('user-token', staged)).resolves.toEqual({ id: 'existing-import', status: 'ready_for_review' });
    expect(fetcher.mock.calls[1][0].searchParams.get('status')).toBe('not.in.(discarded,undone)');
  });

  it('lists a caller-owned account history and discards only a review-ready import', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([summary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ ...summary, status: 'discarded' }])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.list('account-id', 'user-token')).resolves.toMatchObject([{ id: 'import-id', fileName: 'activity.csv' }]);
    await expect(repository.discard('import-id', 'user-token')).resolves.toMatchObject({ status: 'discarded' });
    expect(fetcher.mock.calls[1][0].searchParams.get('status')).toBe('eq.ready_for_review');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ status: 'discarded' });
  });

  it('gets a visible review detail only when both import and source-row RLS queries return data', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([summary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'row-id', row_number: 2, raw_row: { 'activity date': '2026-01-02' }, normalized_payload: { type: 'interest' }, parse_status: 'supported', message: null }])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.get('import-id', 'user-token')).resolves.toMatchObject({ import: { id: 'import-id' }, sourceRows: [{ rowNumber: 2, status: 'supported' }] });
    expect(fetcher.mock.calls[1][0].pathname).toBe('/rest/v1/import_source_rows');
  });

  it('uses the commit RPC, then returns the RLS-scoped committed import summary', async () => {
    const committedSummary = { ...summary, status: 'committed' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify('import-id')))
      .mockResolvedValueOnce(new Response(JSON.stringify([committedSummary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.commit('import-id', 'user-token')).resolves.toMatchObject({ id: 'import-id', status: 'committed' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe('/rest/v1/rpc/commit_import');
    expect(init.headers).toMatchObject({ authorization: 'Bearer user-token' });
    expect(JSON.parse(init.body)).toEqual({ p_import_id: 'import-id' });
  });

  it('turns a rejected database commit into a safe review conflict', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Resolve invalid rows.' }), { status: 400 }));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.commit('import-id', 'user-token')).rejects.toBeInstanceOf(ImportOperationRejectedError);
  });

  it('returns the committed result when a retry observes the prior successful commit', async () => {
    const committedSummary = { ...summary, status: 'committed' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'already committed' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([committedSummary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.commit('import-id', 'user-token')).resolves.toMatchObject({ id: 'import-id', status: 'committed' });
  });

  it('uses the undo RPC, then returns the RLS-scoped undone import summary', async () => {
    const undoneSummary = { ...summary, status: 'undone' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify('import-id')))
      .mockResolvedValueOnce(new Response(JSON.stringify([undoneSummary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.undo('import-id', 'user-token')).resolves.toMatchObject({ id: 'import-id', status: 'undone' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe('/rest/v1/rpc/undo_import');
    expect(init.headers).toMatchObject({ authorization: 'Bearer user-token' });
    expect(JSON.parse(init.body)).toEqual({ p_import_id: 'import-id' });
  });

  it('returns the undone result when a retry observes the prior successful undo', async () => {
    const undoneSummary = { ...summary, status: 'undone' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'already undone' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([undoneSummary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.undo('import-id', 'user-token')).resolves.toMatchObject({ id: 'import-id', status: 'undone' });
  });
});
