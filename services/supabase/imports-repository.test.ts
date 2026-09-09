import { describe, expect, it, vi } from 'vitest';
import { SupabaseImportsRepository } from '@/services/supabase/imports-repository';

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
});
