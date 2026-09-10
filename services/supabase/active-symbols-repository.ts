import { z } from 'zod';

const lotSchema = z.object({ instrument_id: z.string().uuid() });
const aliasSchema = z.object({ instrument_id: z.string().uuid(), symbol: z.string().min(1) });

export type SupabaseActiveSymbolsRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Finds one shared current ticker list for the scheduled EOD job. */
export class SupabaseActiveSymbolsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseActiveSymbolsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for active-symbol discovery.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async list(): Promise<string[]> {
    const lotsUrl = new URL('/rest/v1/lots', this.baseUrl);
    lotsUrl.searchParams.set('select', 'instrument_id');
    lotsUrl.searchParams.set('remaining_quantity', 'gt.0');
    const lotsResponse = await this.fetcher(lotsUrl, { headers: this.headers() });
    if (!lotsResponse.ok) throw new Error(`Supabase active-lot query failed with HTTP ${lotsResponse.status}.`);
    const lots = z.array(lotSchema).parse(await lotsResponse.json());
    const instrumentIds = [...new Set(lots.map((lot) => lot.instrument_id))];
    if (instrumentIds.length === 0) return [];

    const aliasesUrl = new URL('/rest/v1/instrument_aliases', this.baseUrl);
    aliasesUrl.searchParams.set('select', 'instrument_id,symbol');
    aliasesUrl.searchParams.set('effective_to', 'is.null');
    aliasesUrl.searchParams.set('instrument_id', 'in.(' + instrumentIds.join(',') + ')');
    const aliasesResponse = await this.fetcher(aliasesUrl, { headers: this.headers() });
    if (!aliasesResponse.ok) throw new Error(`Supabase instrument-alias query failed with HTTP ${aliasesResponse.status}.`);
    const aliases = z.array(aliasSchema).parse(await aliasesResponse.json());
    const wanted = new Set(instrumentIds);
    return [...new Set(aliases.filter((alias) => wanted.has(alias.instrument_id)).map((alias) => alias.symbol.trim().toUpperCase()).filter(Boolean))].sort();
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}
