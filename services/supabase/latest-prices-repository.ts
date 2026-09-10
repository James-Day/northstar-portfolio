import { z } from 'zod';

const priceSchema = z.object({ instrument_id: z.string().uuid(), trading_date: z.string() });
export type SupabaseLatestPricesRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Reads the newest stored close for report freshness checks. */
export class SupabaseLatestPricesRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseLatestPricesRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for latest-price reads.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async listLatest(instrumentIds: string[]): Promise<Record<string, string | null>> {
    const ids = [...new Set(instrumentIds.map((id) => id.trim()).filter(Boolean))];
    const result: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
    if (ids.length === 0) return result;
    const url = new URL('/rest/v1/daily_prices', this.baseUrl);
    url.searchParams.set('select', 'instrument_id,trading_date');
    url.searchParams.set('instrument_id', 'in.(' + ids.join(',') + ')');
    url.searchParams.set('order', 'trading_date.desc');
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`Supabase latest-price query failed with HTTP ${response.status}.`);
    for (const row of z.array(priceSchema).parse(await response.json())) if (result[row.instrument_id] === null) result[row.instrument_id] = row.trading_date;
    return result;
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}
