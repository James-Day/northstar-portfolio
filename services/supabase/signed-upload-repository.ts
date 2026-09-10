import { z } from 'zod';
import type { AccountsRepository } from '@/services/accounts/accounts';

export type SignedUpload = { bucket: 'brokerage-statements'; path: string; token: string; signedUrl: string };
export type SignedUploadRepository = {
  create(userId: string, accessToken: string, accountId: string, fileName: string): Promise<SignedUpload | undefined>;
  bind?(userId: string, accessToken: string, accountId: string, importId: string, objectPath: string, expectedSha256: string, expectedSize: number): Promise<void | undefined>;
};

const responseSchema = z.object({ path: z.string().min(1), token: z.string().min(1), signedUrl: z.string().url().optional() });

/** Issues a private Supabase Storage upload URL only after the account is RLS-authorized. */
export class SupabaseSignedUploadRepository implements SignedUploadRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: { supabaseUrl: string; supabaseAnonKey: string; accounts: AccountsRepository; fetcher?: typeof fetch }) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for signed uploads.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async create(userId: string, accessToken: string, accountId: string, fileName: string): Promise<SignedUpload | undefined> {
    if (!await this.options.accounts.get(userId, accessToken, accountId)) return undefined;
    if (!/^[^/\\\p{Cc}]{1,255}\.csv$/iu.test(fileName)) throw new Error('Statement file name must be a CSV name without path characters.');
    const path = `${userId}/${accountId}/${crypto.randomUUID()}-${fileName}`;
    const url = new URL(`/storage/v1/object/upload/sign/brokerage-statements/${encodeURIComponent(path)}`, this.baseUrl);
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Supabase signed upload creation failed with HTTP ${response.status}.`);
    const parsed = responseSchema.parse(await response.json());
    return { bucket: 'brokerage-statements', path, token: parsed.token, signedUrl: parsed.signedUrl ?? new URL(`/storage/v1/object/upload/sign/${parsed.token}`, this.baseUrl).toString() };
  }

  async bind(userId: string, accessToken: string, accountId: string, importId: string, objectPath: string, expectedSha256: string, expectedSize: number): Promise<void | undefined> {
    if (!await this.options.accounts.get(userId, accessToken, accountId)) return undefined;
    if (!/^[0-9a-f]{64}$/u.test(expectedSha256) || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 10 * 1024 * 1024) throw new Error('Invalid statement object metadata.');
    const prefix = `${userId}/${accountId}/`;
    if (!objectPath.startsWith(prefix) || objectPath.includes('..') || objectPath.includes('\\') || objectPath.split('/').some((part) => !part)) throw new Error('Storage object path is invalid.');
    const objectUrl = new URL(`/storage/v1/object/brokerage-statements/${objectPath.split('/').map(encodeURIComponent).join('/')}`, this.baseUrl);
    const response = await this.fetcher(objectUrl, { headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) return undefined;
      throw new Error(`Supabase private object verification failed with HTTP ${response.status}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedSize) throw new Error('Uploaded statement size does not match its verified metadata.');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== expectedSha256) throw new Error('Uploaded statement hash does not match the staged import.');
    const bindUrl = new URL('/rest/v1/rpc/bind_import_object', this.baseUrl);
    const bindResponse = await this.fetcher(bindUrl, { method: 'POST', headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_import_id: importId, p_account_id: accountId, p_storage_object_path: objectPath, p_storage_object_sha256: digest, p_storage_object_size: bytes.byteLength }) });
    if (bindResponse.status === 401 || bindResponse.status === 403 || bindResponse.status === 404) return undefined;
    if (!bindResponse.ok) throw new Error(`Supabase import object binding failed with HTTP ${bindResponse.status}.`);
  }
}
