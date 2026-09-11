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

  it('hashes and size-verifies the private object before binding it to the import', async () => {
    const bytes = new TextEncoder().encode('date,amount\n2026-01-01,10\n');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get: vi.fn().mockResolvedValue({ id: 'account-1' }) } as never, fetcher: fetcher as typeof fetch });
    await expect(repository.bind?.('user-1', 'session-1', 'account-1', 'import-1', 'user-1/account-1/object.csv', hash, bytes.byteLength)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain('/rest/v1/rpc/bind_import_object');
    expect(String(fetcher.mock.calls[1][1]?.body)).toContain(hash);
  });

  it('rejects a mismatched object hash without binding', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('different', { status: 200 }));
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get: vi.fn().mockResolvedValue({ id: 'account-1' }) } as never, fetcher: fetcher as typeof fetch });
    await expect(repository.bind?.('user-1', 'session-1', 'account-1', 'import-1', 'user-1/account-1/object.csv', 'a'.repeat(64), 9)).rejects.toThrow('hash');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an object path belonging to another account before touching storage', async () => {
    const fetcher = vi.fn();
    const repository = new SupabaseSignedUploadRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', accounts: { get: vi.fn().mockResolvedValue({ id: 'account-1' }) } as never, fetcher: fetcher as typeof fetch });
    await expect(repository.bind?.('user-1', 'session-1', 'account-1', 'import-1', 'user-1/account-2/object.csv', 'a'.repeat(64), 128)).rejects.toThrow('path');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
