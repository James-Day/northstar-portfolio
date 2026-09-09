export type ImportsRepository = {
  hasFileHash(accountId: string, accessToken: string, fileSha256: string): Promise<boolean>;
};

export type SupabaseImportsRepositoryOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  fetcher?: typeof fetch;
};

/** The user token is intentionally forwarded so import RLS verifies account ownership. */
export class SupabaseImportsRepository implements ImportsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseImportsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for import queries.');
    this.fetcher = options.fetcher ?? fetch;
  }

  async hasFileHash(accountId: string, accessToken: string, fileSha256: string): Promise<boolean> {
    const url = new URL('/rest/v1/imports', this.baseUrl);
    url.searchParams.set('account_id', `eq.${accountId}`);
    url.searchParams.set('file_sha256', `eq.${fileSha256}`);
    url.searchParams.set('select', 'id');
    url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Supabase import query failed with HTTP ${response.status}.`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase import query returned an invalid result.');
    return rows.length > 0;
  }
}
