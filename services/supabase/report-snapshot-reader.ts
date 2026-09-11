import { z } from 'zod';
import type { ReportSnapshotInput } from '@/services/supabase/report-snapshots-repository';

const rowSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), account_id: z.string().uuid().nullable(), report_type: z.enum(['account_daily', 'consolidated_daily', 'dashboard']), as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), import_state_revision: z.string().min(1), price_revision_id: z.string().uuid().nullable(), payload: z.record(z.string(), z.unknown()), published_at: z.string().datetime() });
export type ReportSnapshot = Omit<ReportSnapshotInput, 'userId' | 'accountId' | 'reportType' | 'asOfDate' | 'importStateRevision' | 'priceRevisionId'> & { id: string; userId: string; accountId: string | null; reportType: ReportSnapshotInput['reportType']; asOfDate: string; importStateRevision: string; priceRevisionId: string | null; publishedAt: string };
export type SupabaseReportSnapshotReaderOptions = { supabaseUrl: string; anonKey: string; fetcher?: typeof fetch };

/** Reads the latest account snapshot with the caller token so Supabase RLS enforces ownership. */
export class SupabaseReportSnapshotReader {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;
  constructor(private readonly options: SupabaseReportSnapshotReaderOptions) { this.baseUrl = new URL(options.supabaseUrl); if (!options.anonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for report snapshot reads.'); this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init)); }
  async getLatest(accountId: string, accessToken: string): Promise<ReportSnapshot | undefined> {
    const url = new URL('/rest/v1/report_snapshots', this.baseUrl);
    url.searchParams.set('select', 'id,user_id,account_id,report_type,as_of_date,import_state_revision,price_revision_id,payload,published_at');
    url.searchParams.set('account_id', 'eq.' + accountId);
    url.searchParams.set('report_type', 'eq.account_daily');
    // Date is the report’s visible chronology; publication time selects the
    // newest dependency revision on that date and id breaks timestamp ties.
    url.searchParams.set('order', 'as_of_date.desc,published_at.desc,id.desc');
    url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: { apikey: this.options.anonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Supabase report snapshot query failed with HTTP ${response.status}.`);
    const row = z.array(rowSchema).parse(await response.json())[0];
    // Treat a malformed or unexpectedly broad response as empty. RLS should
    // enforce this server-side, but a client must fail closed before rendering
    // another account's report if a proxy or policy is misconfigured.
    if (row && (row.account_id !== accountId || row.report_type !== 'account_daily')) return undefined;
    return row ? { id: row.id, userId: row.user_id, accountId: row.account_id, reportType: row.report_type, asOfDate: row.as_of_date, importStateRevision: row.import_state_revision, priceRevisionId: row.price_revision_id, payload: row.payload, publishedAt: row.published_at } : undefined;
  }

  /** Reads the caller's latest consolidated snapshot; RLS still enforces ownership. */
  async getLatestConsolidated(userId: string, accessToken: string): Promise<ReportSnapshot | undefined> {
    const url = new URL('/rest/v1/report_snapshots', this.baseUrl);
    url.searchParams.set('select', 'id,user_id,account_id,report_type,as_of_date,import_state_revision,price_revision_id,payload,published_at');
    url.searchParams.set('account_id', 'is.null');
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('report_type', 'eq.consolidated_daily');
    url.searchParams.set('order', 'as_of_date.desc,published_at.desc,id.desc');
    url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: { apikey: this.options.anonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Supabase consolidated report snapshot query failed with HTTP ${response.status}.`);
    const row = z.array(rowSchema).parse(await response.json())[0];
    if (row && (row.user_id !== userId || row.account_id !== null || row.report_type !== 'consolidated_daily')) return undefined;
    return row ? { id: row.id, userId: row.user_id, accountId: row.account_id, reportType: row.report_type, asOfDate: row.as_of_date, importStateRevision: row.import_state_revision, priceRevisionId: row.price_revision_id, payload: row.payload, publishedAt: row.published_at } : undefined;
  }
}
