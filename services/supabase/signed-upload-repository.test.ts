import { describe, expect, it, vi } from 'vitest';
import { SupabaseSignedUploadRepository } from '@/services/supabase/signed-upload-repository';

describe('SupabaseSignedUploadRepository', () => {
  it('checks account ownership before requesting a private signed URL', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'account-1' });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: 'ignored', token: 'token-1', signedUrl: 'https://supabase.test/signed' }), { status: 200 }));
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get } as never, fetcher: fetcher as typeof fetch });
    const result = await repository.create('user-1', 'session-1', 'account-1', 'statement.csv');
    expect(get).toHaveBeenCalledWith('user-1', 'session-1', 'account-1');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ bucket: 'brokerage-statements', token: 'token-1', signedUrl: 'https://supabase.test/signed' });
    expect(result?.path).toMatch(/^user-1\/account-1\/[0-9a-f-]+-statement\.csv$/);
  });

  it('does not call storage when the account is not owned by the user', async () => {
    const fetcher = vi.fn();
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get: vi.fn().mockResolvedValue(undefined) } as never, fetcher: fetcher as typeof fetch });
    await expect(repository.create('user-1', 'session-1', 'other-account', 'statement.csv')).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects path traversal and non-CSV names', async () => {
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get: vi.fn().mockResolvedValue({ id: 'account-1' }) } as never, fetcher: vi.fn() as typeof fetch });
    await expect(repository.create('user-1', 'session-1', 'account-1', '../private.csv')).rejects.toThrow('CSV name');
  });
});
