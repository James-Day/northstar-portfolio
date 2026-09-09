import { describe, expect, it, vi } from 'vitest';
import { SupabaseImportsRepository } from '@/services/supabase/imports-repository';
import { stageRobinhoodImport, toPersistableImportStage } from '@/services/ingestion/staging';

describe('Supabase imports repository', () => {
  it('looks up only the selected account and file hash through the caller token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'import-id' }])));
    const repository = new SupabaseImportsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.hasFileHash('account-id', 'user-token', 'a'.repeat(64))).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.searchParams.get('account_id')).toBe('eq.account-id');
    expect(url.searchParams.get('file_sha256')).toBe(`eq.${'a'.repeat(64)}`);
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
});
