import type { PersistableImportStage } from '@/services/ingestion/staging';

export type StagedImportRecord = { id: string; status: 'ready_for_review' };

export type ImportSummary = {
  id: string;
  accountId: string;
  status: 'ready_for_review' | 'committed' | 'discarded' | 'undone' | 'failed' | 'staged' | 'processing';
  fileName: string;
  sourceRowCount: number;
  usableRowCount: number;
  warningCount: number;
  activityFrom: string | null;
  activityThrough: string | null;
  createdAt: string;
  committedAt?: string | null;
};

export type ImportSourceRow = {
  id: string;
  rowNumber: number;
  raw: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  status: 'supported' | 'unsupported' | 'invalid' | 'duplicate';
  message: string | null;
};

export type ImportReviewDetail = { import: ImportSummary; sourceRows: ImportSourceRow[] };

export type ImportsRepository = {
  hasFileHash(accountId: string, accessToken: string, fileSha256: string): Promise<boolean>;
  stage(accessToken: string, input: PersistableImportStage): Promise<StagedImportRecord>;
  list(accountId: string, accessToken: string): Promise<ImportSummary[]>;
  get(importId: string, accessToken: string): Promise<ImportReviewDetail | undefined>;
  discard(importId: string, accessToken: string): Promise<ImportSummary | undefined>;
  commit(importId: string, accessToken: string): Promise<ImportSummary | undefined>;
  undo(importId: string, accessToken: string): Promise<ImportSummary | undefined>;
};

export type SupabaseImportsRepositoryOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  fetcher?: typeof fetch;
};

/** A review-ready import can still be rejected atomically when its stored rows are invalid. */
export class ImportOperationRejectedError extends Error {
  constructor() {
    super('This import operation cannot proceed until its review issues are resolved.');
    this.name = 'ImportOperationRejectedError';
  }
}

/** The user token is intentionally forwarded so import RLS verifies account ownership. */
export class SupabaseImportsRepository implements ImportsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseImportsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for import queries.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
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

  async list(accountId: string, accessToken: string): Promise<ImportSummary[]> {
    const url = new URL('/rest/v1/imports', this.baseUrl);
    url.searchParams.set('account_id', `eq.${accountId}`);
    url.searchParams.set('select', 'id,account_id,status,file_name,source_row_count,usable_row_count,warning_count,activity_from,activity_through,created_at,committed_at');
    url.searchParams.set('order', 'created_at.desc');
    const response = await this.fetcher(url, { headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Supabase import list failed with HTTP ${response.status}.`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase import list returned an invalid result.');
    return rows.map(toImportSummary);
  }

  async get(importId: string, accessToken: string): Promise<ImportReviewDetail | undefined> {
    const importUrl = new URL('/rest/v1/imports', this.baseUrl);
    importUrl.searchParams.set('id', `eq.${importId}`);
    importUrl.searchParams.set('select', 'id,account_id,status,file_name,source_row_count,usable_row_count,warning_count,activity_from,activity_through,created_at,committed_at');
    importUrl.searchParams.set('limit', '1');
    const importResponse = await this.fetcher(importUrl, { headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` } });
    if (!importResponse.ok) throw new Error(`Supabase import query failed with HTTP ${importResponse.status}.`);
    const importRows: unknown = await importResponse.json();
    if (!Array.isArray(importRows)) throw new Error('Supabase import query returned an invalid result.');
    if (!importRows[0]) return undefined;

    const sourceRowsUrl = new URL('/rest/v1/import_source_rows', this.baseUrl);
    sourceRowsUrl.searchParams.set('import_id', `eq.${importId}`);
    sourceRowsUrl.searchParams.set('select', 'id,row_number,raw_row,normalized_payload,parse_status,message');
    sourceRowsUrl.searchParams.set('order', 'row_number.asc');
    const sourceRowsResponse = await this.fetcher(sourceRowsUrl, { headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` } });
    if (!sourceRowsResponse.ok) throw new Error(`Supabase import source-row query failed with HTTP ${sourceRowsResponse.status}.`);
    const sourceRows: unknown = await sourceRowsResponse.json();
    if (!Array.isArray(sourceRows)) throw new Error('Supabase import source-row query returned an invalid result.');
    return { import: toImportSummary(importRows[0]), sourceRows: sourceRows.map(toImportSourceRow) };
  }

  async discard(importId: string, accessToken: string): Promise<ImportSummary | undefined> {
    const url = new URL('/rest/v1/imports', this.baseUrl);
    url.searchParams.set('id', `eq.${importId}`);
    url.searchParams.set('status', 'eq.ready_for_review');
    const response = await this.fetcher(url, {
      method: 'PATCH',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ status: 'discarded' }),
    });
    if (!response.ok) throw new Error(`Supabase import discard failed with HTTP ${response.status}.`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase import discard returned an invalid result.');
    return rows[0] ? toImportSummary(rows[0]) : undefined;
  }

  async commit(importId: string, accessToken: string): Promise<ImportSummary | undefined> {
    const rpcUrl = new URL('/rest/v1/rpc/commit_import', this.baseUrl);
    const response = await this.fetcher(rpcUrl, {
      method: 'POST',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_import_id: importId }),
    });
    if (response.status === 403 || response.status === 404) return undefined;
    if (response.status === 400 || response.status === 409) throw new ImportOperationRejectedError();
    if (!response.ok) throw new Error(`Supabase import commit failed with HTTP ${response.status}.`);
    const committedId: unknown = await response.json();
    if (typeof committedId !== 'string') throw new Error('Supabase import commit returned an invalid import ID.');
    return this.get(committedId, accessToken).then((detail) => detail?.import);
  }

  async undo(importId: string, accessToken: string): Promise<ImportSummary | undefined> {
    const rpcUrl = new URL('/rest/v1/rpc/undo_import', this.baseUrl);
    const response = await this.fetcher(rpcUrl, {
      method: 'POST',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_import_id: importId }),
    });
    if (response.status === 403 || response.status === 404) return undefined;
    if (response.status === 400 || response.status === 409) throw new ImportOperationRejectedError();
    if (!response.ok) throw new Error(`Supabase import undo failed with HTTP ${response.status}.`);
    const undoneId: unknown = await response.json();
    if (typeof undoneId !== 'string') throw new Error('Supabase import undo returned an invalid import ID.');
    return this.get(undoneId, accessToken).then((detail) => detail?.import);
  }
}

function toImportSummary(row: unknown): ImportSummary {
  if (!row || typeof row !== 'object') throw new Error('Supabase returned an invalid import row.');
  const value = row as Record<string, unknown>;
  const statusValues = ['staged', 'processing', 'ready_for_review', 'committed', 'discarded', 'undone', 'failed'] as const;
  if (typeof value.id !== 'string' || typeof value.account_id !== 'string' || !statusValues.includes(value.status as typeof statusValues[number]) || typeof value.file_name !== 'string' || typeof value.source_row_count !== 'number' || typeof value.usable_row_count !== 'number' || typeof value.warning_count !== 'number' || typeof value.created_at !== 'string' || (value.activity_from !== null && typeof value.activity_from !== 'string') || (value.activity_through !== null && typeof value.activity_through !== 'string') || (value.committed_at !== undefined && value.committed_at !== null && typeof value.committed_at !== 'string')) {
    throw new Error('Supabase returned an invalid import row.');
  }
  return {
    id: value.id,
    accountId: value.account_id,
    status: value.status as ImportSummary['status'],
    fileName: value.file_name,
    sourceRowCount: value.source_row_count,
    usableRowCount: value.usable_row_count,
    warningCount: value.warning_count,
    activityFrom: value.activity_from,
    activityThrough: value.activity_through,
    createdAt: value.created_at,
    committedAt: typeof value.committed_at === 'string' ? value.committed_at : null,
  };
}

function toImportSourceRow(row: unknown): ImportSourceRow {
  if (!row || typeof row !== 'object') throw new Error('Supabase returned an invalid import source row.');
  const value = row as Record<string, unknown>;
  const rowNumber = value.row_number;
  const statusValues = ['supported', 'unsupported', 'invalid', 'duplicate'] as const;
  if (typeof value.id !== 'string' || typeof rowNumber !== 'number' || !Number.isInteger(rowNumber) || rowNumber < 2 || !value.raw_row || typeof value.raw_row !== 'object' || !statusValues.includes(value.parse_status as typeof statusValues[number]) || (value.normalized_payload !== null && (typeof value.normalized_payload !== 'object' || Array.isArray(value.normalized_payload))) || (value.message !== null && typeof value.message !== 'string')) {
    throw new Error('Supabase returned an invalid import source row.');
  }
  return {
    id: value.id,
    rowNumber,
    raw: value.raw_row as Record<string, unknown>,
    normalizedPayload: value.normalized_payload as Record<string, unknown> | null,
    status: value.parse_status as ImportSourceRow['status'],
    message: value.message as string | null,
  };
}
