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
}
