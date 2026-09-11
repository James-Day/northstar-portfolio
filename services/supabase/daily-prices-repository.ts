import { z } from 'zod';
import type { DailyPrice } from '@/services/market-data/types';

const revisionSchema = z.object({ id: z.string().uuid(), source: z.enum(['dolthub', 'marketstack', 'manual_correction']), source_revision: z.string() });
const aliasSchema = z.object({ instrument_id: z.string().uuid(), symbol: z.string(), effective_from: z.string(), effective_to: z.string().nullable() });
export type SupabaseDailyPricesRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Persists normalized provider closes behind a service-only Supabase credential. */
export class SupabaseDailyPricesRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseDailyPricesRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for daily price writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  /** Returns only symbols without a stored close for the requested date. */
  async getMissingSymbols(symbols: string[], tradingDate: string): Promise<string[]> {
    const requested = validatedSymbols(symbols);
    if (requested.length === 0) return [];
    const aliasUrl = new URL('/rest/v1/instrument_aliases', this.baseUrl);
    aliasUrl.searchParams.set('select', 'instrument_id,symbol');
    aliasUrl.searchParams.set('symbol', 'in.(' + requested.join(',') + ')');
    const aliasResponse = await this.fetcher(aliasUrl, { headers: this.headers() });
    if (!aliasResponse.ok) throw new Error(`Supabase instrument-alias lookup failed with HTTP ${aliasResponse.status}.`);
    const aliases = z.array(z.object({ instrument_id: z.string().uuid(), symbol: z.string() })).parse(await aliasResponse.json());
    const instrumentIds = [...new Set(aliases.map((alias) => alias.instrument_id))];
    if (instrumentIds.length === 0) return requested;
    const priceUrl = new URL('/rest/v1/daily_prices', this.baseUrl);
    priceUrl.searchParams.set('select', 'instrument_id');
    priceUrl.searchParams.set('instrument_id', 'in.(' + instrumentIds.join(',') + ')');
    priceUrl.searchParams.set('trading_date', `eq.${tradingDate}`);
    const priceResponse = await this.fetcher(priceUrl, { headers: this.headers() });
    if (!priceResponse.ok) throw new Error(`Supabase daily price lookup failed with HTTP ${priceResponse.status}.`);
    const rows = z.array(z.object({ instrument_id: z.string().uuid() })).parse(await priceResponse.json());
    const presentIds = new Set(rows.map((row) => row.instrument_id));
    const presentSymbols = new Set(aliases.filter((alias) => presentIds.has(alias.instrument_id)).map((alias) => alias.symbol.toUpperCase()));
    return requested.filter((symbol) => !presentSymbols.has(symbol));
  }

  async persist(input: { tradingDate: string; prices: DailyPrice[] }): Promise<{ upserted: number }> {
    if (input.prices.length === 0) return { upserted: 0 };
    const normalizedSymbols = validatedSymbols(input.prices.map((price) => price.symbol), false);
    if (input.prices.some((price) => price.tradingDate !== input.tradingDate)) throw new Error('Daily price payload contains a date different from the requested trading date.');
    if (new Set(normalizedSymbols).size !== normalizedSymbols.length) throw new Error('Daily price payload contains duplicate symbols.');
    // A revision identifies the logical provider snapshot, so symbol order in
    // a retried or differently paginated active-symbol read must not create a
    // second revision for the same date.
    const sourceRevision = input.prices
      .map((price, index) => ({ symbol: normalizedSymbols[index], revision: `${price.provider}:${String(price.providerMetadata.requestedDate ?? input.tradingDate)}` }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .map(({ revision }) => revision)
      .join('|');
    const revisionUrl = new URL('/rest/v1/price_revisions', this.baseUrl);
    revisionUrl.searchParams.set('on_conflict', 'source,source_revision');
    const revisionResponse = await this.fetcher(revisionUrl, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ source: input.prices[0].provider, source_revision: sourceRevision }) });
    if (!revisionResponse.ok) throw new Error(`Supabase price revision write failed with HTTP ${revisionResponse.status}.`);
    const revisions = z.array(revisionSchema).parse(await revisionResponse.json());
    const revisionId = revisions[0]?.id;
    if (!revisionId) throw new Error('Supabase did not return the daily price revision ID.');
    const symbols = normalizedSymbols;
    const aliasUrl = new URL('/rest/v1/instrument_aliases', this.baseUrl);
    aliasUrl.searchParams.set('select', 'instrument_id,symbol,effective_from,effective_to');
    aliasUrl.searchParams.set('symbol', 'in.(' + symbols.join(',') + ')');
    const aliasResponse = await this.fetcher(aliasUrl, { headers: this.headers() });
    if (!aliasResponse.ok) throw new Error(`Supabase instrument-alias lookup failed with HTTP ${aliasResponse.status}.`);
    const aliases = z.array(aliasSchema).parse(await aliasResponse.json());
    const instrumentFor = (price: DailyPrice) => {
      const matches = aliases.filter((alias) => alias.symbol === price.symbol.toUpperCase() && alias.effective_from <= price.tradingDate && (alias.effective_to === null || alias.effective_to >= price.tradingDate));
      if (matches.length !== 1) throw new Error(`Expected one effective instrument alias for ${price.symbol} on ${price.tradingDate}.`);
      return matches[0].instrument_id;
    };
    const priceUrl = new URL('/rest/v1/daily_prices', this.baseUrl);
    priceUrl.searchParams.set('on_conflict', 'instrument_id,trading_date,price_revision_id');
    const response = await this.fetcher(priceUrl, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(input.prices.map((price) => ({ instrument_id: instrumentFor(price), trading_date: price.tradingDate, close: price.close, price_revision_id: revisionId }))) });
    if (!response.ok) throw new Error(`Supabase daily price write failed with HTTP ${response.status}.`);
    return { upserted: input.prices.length };
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}

function validatedSymbols(values: string[], deduplicate = true): string[] {
  const normalized = values.map((value) => value.trim().toUpperCase()).filter(Boolean);
  const symbols = deduplicate ? [...new Set(normalized)] : normalized;
  if (symbols.some((symbol) => !/^[A-Z0-9][A-Z0-9._-]{0,14}$/u.test(symbol))) {
    throw new Error('Daily price payload contains an invalid ticker symbol.');
  }
  return symbols;
}
