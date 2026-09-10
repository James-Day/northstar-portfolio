import { z } from 'zod';

const snapshotSchema = z.object({ id: z.string().uuid() });
export type ReportSnapshotInput = { userId: string; accountId?: string | null; reportType: 'account_daily' | 'consolidated_daily' | 'dashboard'; asOfDate: string; importStateRevision: string; priceRevisionId?: string | null; payload: Record<string, unknown> };
export type SupabaseReportSnapshotsRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Publishes an immutable, versioned report payload as one database insert. */
export class SupabaseReportSnapshotsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseReportSnapshotsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for report snapshots.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async publish(input: ReportSnapshotInput): Promise<string> {
    if (!input.importStateRevision.trim()) throw new Error('Report snapshots require an import-state revision.');
    const url = new URL('/rest/v1/report_snapshots', this.baseUrl);
    url.searchParams.set('on_conflict', 'publication_key');
    const response = await this.fetcher(url, { method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: input.userId, account_id: input.accountId ?? null, report_type: input.reportType, as_of_date: input.asOfDate, import_state_revision: input.importStateRevision, price_revision_id: input.priceRevisionId ?? null, payload: input.payload }) });
    if (!response.ok) throw new Error(`Supabase report snapshot write failed with HTTP ${response.status}.`);
    const rows = z.array(snapshotSchema).parse(await response.json());
    if (!rows[0]) throw new Error('Supabase did not return a report snapshot ID.');
    return rows[0].id;
  }
}
