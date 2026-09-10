import { z } from 'zod';

const snapshotSchema = z.object({ id: z.string().uuid() });
const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'an ISO date');
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
    validateInput(input);
    const url = new URL('/rest/v1/report_snapshots', this.baseUrl);
    url.searchParams.set('on_conflict', 'publication_key');
    const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(toRow(input)) });
    if (!response.ok) throw new Error(`Supabase report snapshot write failed with HTTP ${response.status}.`);
    const rows = z.array(snapshotSchema).parse(await response.json());
    if (rows[0]) return rows[0].id;

    // A retry that races an existing publication returns no representation when
    // duplicates are ignored. Read the exact dependency key instead of
    // replacing the original payload, preserving snapshot immutability.
    const existing = new URL('/rest/v1/report_snapshots', this.baseUrl);
    existing.searchParams.set('select', 'id');
    existing.searchParams.set('user_id', 'eq.' + input.userId);
    existing.searchParams.set('account_id', input.accountId ? 'eq.' + input.accountId : 'is.null');
    existing.searchParams.set('report_type', 'eq.' + input.reportType);
    existing.searchParams.set('as_of_date', 'eq.' + input.asOfDate);
    existing.searchParams.set('import_state_revision', 'eq.' + input.importStateRevision);
    existing.searchParams.set('price_revision_id', input.priceRevisionId ? 'eq.' + input.priceRevisionId : 'is.null');
    existing.searchParams.set('limit', '1');
    const existingResponse = await this.fetcher(existing, { headers: this.headers() });
    if (!existingResponse.ok) throw new Error(`Supabase report snapshot lookup failed with HTTP ${existingResponse.status}.`);
    const existingRows = z.array(snapshotSchema).parse(await existingResponse.json());
    if (!existingRows[0]) throw new Error('Supabase did not return the report snapshot created by the concurrent publication.');
    return existingRows[0].id;
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}

function validateInput(input: ReportSnapshotInput) {
  uuidSchema.parse(input.userId);
  if (input.accountId !== undefined && input.accountId !== null) uuidSchema.parse(input.accountId);
  if (input.priceRevisionId !== undefined && input.priceRevisionId !== null) uuidSchema.parse(input.priceRevisionId);
  dateSchema.parse(input.asOfDate);
  if (!input.importStateRevision.trim()) throw new Error('Report snapshots require an import-state revision.');
  if (input.reportType === 'account_daily' && !input.accountId) throw new Error('Account reports require an account dependency.');
}

function toRow(input: ReportSnapshotInput) {
  return { user_id: input.userId, account_id: input.accountId ?? null, report_type: input.reportType, as_of_date: input.asOfDate, import_state_revision: input.importStateRevision, price_revision_id: input.priceRevisionId ?? null, payload: input.payload };
}
