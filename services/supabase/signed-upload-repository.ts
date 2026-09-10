import { z } from 'zod';
import type { AccountsRepository } from '@/services/accounts/accounts';

export type SignedUpload = { bucket: 'brokerage-statements'; path: string; token: string; signedUrl: string };
export type SignedUploadRepository = {
  create(userId: string, accessToken: string, accountId: string, fileName: string): Promise<SignedUpload | undefined>;
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
}
