import { z } from 'zod';
import { isoDate, type IsoDate } from '@/lib/domain/types';
import { buildPriceFreshnessReport, type PriceFreshnessReportRepository } from '@/services/reporting/price-freshness';
import { SupabaseLatestPricesRepository } from '@/services/supabase/latest-prices-repository';

const accountSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid() });
const lotSchema = z.object({ instrument_id: z.string().uuid() });
const aliasSchema = z.object({ instrument_id: z.string().uuid(), symbol: z.string().min(1), effective_from: z.string(), effective_to: z.string().nullable() });
export type PriceFreshnessReportRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch; clock?: () => Date };

/** Builds an account-scoped freshness report from stored lots, aliases, and closes. */
export class SupabasePriceFreshnessReportRepository implements PriceFreshnessReportRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;
  private readonly latest: SupabaseLatestPricesRepository;
  private readonly clock: () => Date;

  constructor(private readonly options: PriceFreshnessReportRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for freshness reports.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.latest = new SupabaseLatestPricesRepository(options);
    this.clock = options.clock ?? (() => new Date());
  }

  async get(accountId: string, userId: string, _accessToken: string) {
    const accountUrl = new URL('/rest/v1/accounts', this.baseUrl);
    accountUrl.searchParams.set('select', 'id,user_id');
    accountUrl.searchParams.set('id', 'eq.' + accountId);
    const accountResponse = await this.fetcher(accountUrl, { headers: this.headers() });
    if (!accountResponse.ok) throw new Error(`Supabase account ownership query failed with HTTP ${accountResponse.status}.`);
    const account = z.array(accountSchema).parse(await accountResponse.json())[0];
    if (!account || account.user_id !== userId) return undefined;

    const lotsUrl = new URL('/rest/v1/lots', this.baseUrl);
    lotsUrl.searchParams.set('select', 'instrument_id');
    lotsUrl.searchParams.set('account_id', 'eq.' + accountId);
    lotsUrl.searchParams.set('remaining_quantity', 'gt.0');
    const lotsResponse = await this.fetcher(lotsUrl, { headers: this.headers() });
    if (!lotsResponse.ok) throw new Error(`Supabase report-lot query failed with HTTP ${lotsResponse.status}.`);
    const instrumentIds = [...new Set(z.array(lotSchema).parse(await lotsResponse.json()).map((lot) => lot.instrument_id))];
    if (instrumentIds.length === 0) return { expectedDate: today(this.clock), rows: [] };

    const aliasUrl = new URL('/rest/v1/instrument_aliases', this.baseUrl);
    aliasUrl.searchParams.set('select', 'instrument_id,symbol,effective_from,effective_to');
    aliasUrl.searchParams.set('instrument_id', 'in.(' + instrumentIds.join(',') + ')');
    const aliasResponse = await this.fetcher(aliasUrl, { headers: this.headers() });
    if (!aliasResponse.ok) throw new Error(`Supabase report-alias query failed with HTTP ${aliasResponse.status}.`);
    const aliases = z.array(aliasSchema).parse(await aliasResponse.json());
    const expectedDate = today(this.clock);
    const instruments = aliases.filter((alias) => alias.effective_from <= expectedDate && (alias.effective_to === null || alias.effective_to >= expectedDate)).map((alias) => ({ instrumentId: alias.instrument_id as never, symbol: alias.symbol }));
    const latestByInstrument = Object.fromEntries(Object.entries(await this.latest.listLatest(instrumentIds)).map(([id, date]) => [id, date ? isoDate(date) : null]));
    return { expectedDate, rows: buildPriceFreshnessReport({ instruments, expectedDate: expectedDate as never, latestByInstrument }) };
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}

function today(clock: () => Date): IsoDate { return isoDate(clock().toISOString().slice(0, 10)); }
