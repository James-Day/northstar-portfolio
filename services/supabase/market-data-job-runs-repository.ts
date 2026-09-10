import { z } from 'zod';

const runSchema = z.object({ id: z.string().uuid() });
export type MarketDataJobRun = { tradingDate: string | null; status: 'persisted' | 'skipped' | 'failed'; attempts: number; failedAttempts: number; requestedSymbols: number; persistedRows: number; quotaUnits: number; errorMessage?: string | null };

export type MarketDataJobRunsRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Writes operational pricing runs with the service role; browser tokens have no access. */
export class SupabaseMarketDataJobRunsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: MarketDataJobRunsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for market-data job run writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async record(run: MarketDataJobRun): Promise<string> {
    const url = new URL('/rest/v1/market_data_job_runs', this.baseUrl);
    const response = await this.fetcher(url, { method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ trading_date: run.tradingDate, status: run.status, attempts: run.attempts, failed_attempts: run.failedAttempts, requested_symbols: run.requestedSymbols, persisted_rows: run.persistedRows, quota_units: run.quotaUnits, error_message: run.errorMessage ?? null }) });
    if (!response.ok) throw new Error(`Supabase market-data job run write failed with HTTP ${response.status}.`);
    const rows = z.array(runSchema).parse(await response.json());
    if (!rows[0]) throw new Error('Supabase did not return a market-data job run ID.');
    return rows[0].id;
  }

  async getMonthlyQuotaUsage(now: Date): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const url = new URL('/rest/v1/market_data_job_runs', this.baseUrl);
    url.searchParams.set('select', 'quota_units');
    url.searchParams.set('created_at', `gte.${monthStart}`);
    const response = await this.fetcher(url, { headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` } });
    if (!response.ok) throw new Error(`Supabase market-data quota query failed with HTTP ${response.status}.`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase market-data quota query returned an invalid result.');
    return rows.reduce((total, row) => {
      const units = row && typeof row === 'object' && typeof (row as { quota_units?: unknown }).quota_units === 'number' ? (row as { quota_units: number }).quota_units : NaN;
      if (!Number.isInteger(units) || units < 0) throw new Error('Supabase returned an invalid quota counter.');
      return total + units;
    }, 0);
  }
}
