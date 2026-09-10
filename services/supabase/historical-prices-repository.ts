import { z } from 'zod';
import type { HistoricalPriceUpsert } from '@/services/market-data/historical-ingestion';
import type { PriceCorrection } from '@/services/market-data/price-corrections';

const revisionSchema = z.object({ id: z.string().uuid(), source: z.literal('dolthub'), source_revision: z.string() });
const correctionSchema = z.object({ id: z.string().uuid() });

export type SupabaseHistoricalPricesRepositoryOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
};

/** Server-only writer for shared historical prices. Never expose the service key to a browser. */
export class SupabaseHistoricalPricesRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseHistoricalPricesRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for historical price writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async persistDoltHubPage(input: { sourceRevision: string; records: HistoricalPriceUpsert[] }): Promise<{ revisionId: string; upserted: number }> {
    if (!input.sourceRevision.trim()) throw new Error('A source revision is required for historical price writes.');
    const revisionUrl = new URL('/rest/v1/price_revisions', this.baseUrl);
    revisionUrl.searchParams.set('on_conflict', 'source,source_revision');
    const revisionResponse = await this.fetcher(revisionUrl, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ source: 'dolthub', source_revision: input.sourceRevision }),
    });
    if (!revisionResponse.ok) throw new Error(`Supabase price revision write failed with HTTP ${revisionResponse.status}.`);
    const revisions = z.array(revisionSchema).parse(await revisionResponse.json());
    const revisionId = revisions[0]?.id;
    if (!revisionId) throw new Error('Supabase did not return the historical price revision ID.');
    if (input.records.length === 0) return { revisionId, upserted: 0 };

    const pricesUrl = new URL('/rest/v1/daily_prices', this.baseUrl);
    pricesUrl.searchParams.set('on_conflict', 'instrument_id,trading_date,price_revision_id');
    const pricesResponse = await this.fetcher(pricesUrl, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(input.records.map((record) => ({ instrument_id: record.instrumentId, trading_date: record.tradingDate, close: record.close, price_revision_id: revisionId }))),
    });
    if (!pricesResponse.ok) throw new Error(`Supabase daily price write failed with HTTP ${pricesResponse.status}.`);
    return { revisionId, upserted: input.records.length };
  }

  async persistCorrection(correction: PriceCorrection): Promise<string> {
    const url = new URL('/rest/v1/price_corrections', this.baseUrl);
    url.searchParams.set('on_conflict', 'instrument_id,trading_date,correction_version');
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ instrument_id: correction.instrumentId, trading_date: correction.tradingDate, corrected_close: correction.correctedClose, evidence: correction.evidence, correction_version: correction.correctionVersion }),
    });
    if (!response.ok) throw new Error(`Supabase price correction write failed with HTTP ${response.status}.`);
    const rows = z.array(correctionSchema).parse(await response.json());
    if (!rows[0]) throw new Error('Supabase did not return a price correction ID.');
    return rows[0].id;
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}
