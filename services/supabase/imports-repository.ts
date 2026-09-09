import type { PersistableImportStage } from '@/services/ingestion/staging';

export type StagedImportRecord = { id: string; status: 'ready_for_review' };

export type ImportsRepository = {
  hasFileHash(accountId: string, accessToken: string, fileSha256: string): Promise<boolean>;
  stage(accessToken: string, input: PersistableImportStage): Promise<StagedImportRecord>;
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

  async stage(accessToken: string, input: PersistableImportStage): Promise<StagedImportRecord> {
    const url = new URL('/rest/v1/rpc/stage_import', this.baseUrl);
    const sourceRows = input.rows.map((row) => ({
      rowNumber: row.rowNumber,
      raw: row.raw,
      status: row.status,
      message: row.message ?? null,
      activity: row.activity ?? null,
    }));
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_account_id: input.accountId,
        p_file_name: input.fileName,
        p_file_sha256: input.fileSha256,
        p_parser_version: input.parserVersion,
        p_source_rows: sourceRows,
        p_activity_from: input.activityFrom,
        p_activity_through: input.activityThrough,
        p_usable_row_count: input.usableRowCount,
        p_warning_count: input.warningCount,
      }),
    });
    if (!response.ok) throw new Error(`Supabase import staging failed with HTTP ${response.status}.`);
    const id: unknown = await response.json();
    if (typeof id !== 'string' || !id) throw new Error('Supabase import staging returned an invalid import ID.');
    return { id, status: 'ready_for_review' };
  }
}
