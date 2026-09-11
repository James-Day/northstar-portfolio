import { z } from 'zod';
import type { IsoDate } from '@/lib/domain/types';
import { isoDate } from '@/lib/domain/types';
import type { HistoricalSeedJobRepository, HistoricalSeedJobState, HistoricalSeedMapping, HistoricalSeedQuarantine } from '@/services/market-data/historical-seed';
import type { HistoricalContinuityIssue, HistoricalPriceUpsert } from '@/services/market-data/historical-ingestion';
import type { DoltHubCloseCursor } from '@/services/market-data/dolthub';

const jobSchema = z.object({
  id: z.string().uuid(), source: z.literal('dolthub'), symbols: z.array(z.string()), from_date: z.string(), through_date: z.string(), page_limit: z.number(), source_revision: z.string().nullable(), cursor_date: z.string().nullable(), cursor_symbol: z.string().nullable(), status: z.enum(['running', 'completed', 'failed']), pages: z.number(), accepted_rows: z.number(), quarantined_rows: z.number(), last_error: z.string().nullable(),
});
export type SupabaseHistoricalSeedRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Server-only durable state/review storage for resumable historical imports. */
export class SupabaseHistoricalSeedRepository implements HistoricalSeedJobRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;
  constructor(private readonly options: SupabaseHistoricalSeedRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for historical seed writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async getOrCreate(input: { symbols: string[]; from: IsoDate; through: IsoDate; pageLimit: number }): Promise<HistoricalSeedJobState> {
    const symbols = [...new Set(input.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
    if (!symbols.length || input.from > input.through) throw new Error('A historical seed requires symbols and a valid date range.');
    const seedKey = `dolthub:${input.from}:${input.through}:${input.pageLimit}:${symbols.join(',')}`;
    const url = new URL('/rest/v1/historical_seed_jobs', this.baseUrl);
    url.searchParams.set('on_conflict', 'seed_key');
    url.searchParams.set('select', '*');
    const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ seed_key: seedKey, source: 'dolthub', symbols, from_date: input.from, through_date: input.through, page_limit: input.pageLimit }) });
    if (!response.ok) throw new Error(`Supabase historical seed job write failed with HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const row = jobSchema.parse(Array.isArray(payload) ? payload[0] : undefined);
    return toState(row);
  }

  async recordPage(input: { jobId: string; pageKey: string; sourceRevision: string; cursor: DoltHubCloseCursor | null; accepted: HistoricalPriceUpsert[]; mappings: HistoricalSeedMapping[]; quarantined: HistoricalSeedQuarantine[]; continuityIssues: HistoricalContinuityIssue[]; upserted: number }): Promise<void> {
    const marker = await this.insertPageMarker(input.jobId, input.pageKey, input.sourceRevision);
    if (!marker) return;
    if (input.mappings.length) await this.insert('/rest/v1/historical_seed_mappings', input.mappings.map((mapping) => ({ seed_job_id: input.jobId, source_revision: input.sourceRevision, source_symbol: mapping.symbol, trading_date: mapping.tradingDate, instrument_id: mapping.instrumentId })));
    if (input.quarantined.length) await this.insert('/rest/v1/historical_seed_quarantine', input.quarantined.map((item) => ({ seed_job_id: item.jobId, source_revision: item.sourceRevision, source_symbol: item.record.symbol, trading_date: item.record.tradingDate, close: item.record.close, reason: item.reason, raw_record: item.record, status: item.status })));
    const current = await this.read(input.jobId);
    const url = new URL('/rest/v1/historical_seed_jobs', this.baseUrl);
    url.searchParams.set('id', `eq.${input.jobId}`);
    const patch = { source_revision: input.sourceRevision, cursor_date: input.cursor?.tradingDate ?? null, cursor_symbol: input.cursor?.symbol ?? null, status: 'running', pages: current.pages + 1, accepted_rows: current.acceptedRows + input.upserted, quarantined_rows: current.quarantinedRows + input.quarantined.length, continuity_issues: input.continuityIssues };
    const response = await this.fetcher(url, { method: 'PATCH', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!response.ok) throw new Error(`Supabase historical seed cursor update failed with HTTP ${response.status}.`);
  }

  async complete(jobId: string): Promise<void> { await this.patch(jobId, { status: 'completed', completed_at: new Date().toISOString(), last_error: null }); }
  async fail(jobId: string, error: string): Promise<void> { await this.patch(jobId, { status: 'failed', last_error: error.slice(0, 2000) }); }

  async listQuarantine(jobId: string, status: 'pending' | 'validated' | 'rejected' = 'pending'): Promise<unknown[]> {
    const url = new URL('/rest/v1/historical_seed_quarantine', this.baseUrl); url.searchParams.set('seed_job_id', `eq.${jobId}`); url.searchParams.set('status', `eq.${status}`); url.searchParams.set('order', 'created_at.asc');
    const response = await this.fetcher(url, { headers: this.headers() }); if (!response.ok) throw new Error(`Supabase historical seed quarantine lookup failed with HTTP ${response.status}.`); return z.array(z.unknown()).parse(await response.json());
  }

  async reviewQuarantine(id: string, status: 'validated' | 'rejected', reviewerId: string, note?: string): Promise<void> {
    const url = new URL('/rest/v1/historical_seed_quarantine', this.baseUrl); url.searchParams.set('id', `eq.${id}`);
    const response = await this.fetcher(url, { method: 'PATCH', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: note ?? null }) });
    if (!response.ok) throw new Error(`Supabase historical seed quarantine review failed with HTTP ${response.status}.`);
  }

  private async patch(jobId: string, body: Record<string, unknown>): Promise<void> { const url = new URL('/rest/v1/historical_seed_jobs', this.baseUrl); url.searchParams.set('id', `eq.${jobId}`); const response = await this.fetcher(url, { method: 'PATCH', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Supabase historical seed job update failed with HTTP ${response.status}.`); }
  private async read(jobId: string): Promise<HistoricalSeedJobState> { const url = new URL('/rest/v1/historical_seed_jobs', this.baseUrl); url.searchParams.set('id', `eq.${jobId}`); url.searchParams.set('select', '*'); const response = await this.fetcher(url, { headers: this.headers() }); if (!response.ok) throw new Error(`Supabase historical seed job lookup failed with HTTP ${response.status}.`); const payload: unknown = await response.json(); const row = jobSchema.parse(Array.isArray(payload) ? payload[0] : undefined); return toState(row); }
  private async insert(path: string, body: unknown[]): Promise<void> { const url = new URL(path, this.baseUrl); url.searchParams.set('on_conflict', path.includes('mappings') ? 'seed_job_id,source_revision,source_symbol,trading_date' : 'seed_job_id,source_revision,source_symbol,trading_date,reason'); const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Supabase historical seed record write failed with HTTP ${response.status}.`); }
  private async insertPageMarker(jobId: string, pageKey: string, sourceRevision: string): Promise<boolean> { const url = new URL('/rest/v1/historical_seed_pages', this.baseUrl); url.searchParams.set('on_conflict', 'seed_job_id,page_key'); const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ seed_job_id: jobId, page_key: pageKey, source_revision: sourceRevision }) }); if (!response.ok) throw new Error(`Supabase historical seed page marker write failed with HTTP ${response.status}.`); const rows: unknown = await response.json(); return Array.isArray(rows) && rows.length > 0; }
  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}

type JobRow = z.infer<typeof jobSchema>;
function toState(row: JobRow): HistoricalSeedJobState { return { id: row.id, source: row.source, symbols: row.symbols, from: isoDate(row.from_date), through: isoDate(row.through_date), pageLimit: row.page_limit, sourceRevision: row.source_revision, cursor: row.cursor_date && row.cursor_symbol ? { tradingDate: isoDate(row.cursor_date), symbol: row.cursor_symbol } : null, status: row.status, pages: row.pages, acceptedRows: row.accepted_rows, quarantinedRows: row.quarantined_rows, lastError: row.last_error }; }
