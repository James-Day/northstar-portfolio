import { z } from 'zod';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type DailyClose, type InstrumentId, type IsoDate } from '@/lib/domain/types';
import type { PriceCorrection } from '@/services/market-data/price-corrections';
import type { CorporateAction } from '@/services/ledger/corporate-actions';

const closeSchema = z.object({ instrument_id: z.string().uuid(), trading_date: z.string(), close: z.string(), price_revisions: z.object({ source: z.enum(['dolthub', 'marketstack', 'manual_correction']), source_revision: z.string() }) });
const correctionSchema = z.object({ instrument_id: z.string().uuid(), trading_date: z.string(), corrected_close: z.string(), evidence: z.string(), correction_version: z.string() });
const actionSchema = z.object({ instrument_id: z.string().uuid(), action_date: z.string(), action_type: z.literal('split'), ratio_numerator: z.string(), ratio_denominator: z.string(), status: z.literal('validated') });
const revisionIdSchema = z.array(z.object({ id: z.string().uuid() }));

export type SupabaseReportInputRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch; pageSize?: number };

/** Reads only validated, date/instrument-scoped market inputs for report jobs. */
export class SupabaseReportInputRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: SupabaseReportInputRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for report input reads.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async listCloses(input: { instrumentIds: InstrumentId[]; from: IsoDate; through: IsoDate }): Promise<DailyClose[]> {
    const ids = validatedInstrumentIds(input.instrumentIds);
    if (ids.length === 0) return [];
    const url = new URL('/rest/v1/daily_prices', this.baseUrl);
    url.searchParams.set('select', 'instrument_id,trading_date,close,price_revisions!inner(source,source_revision)');
    url.searchParams.set('instrument_id', `in.(${ids.join(',')})`);
    url.searchParams.append('trading_date', `gte.${input.from}`);
    url.searchParams.append('trading_date', `lte.${input.through}`);
    url.searchParams.set('order', 'trading_date.asc,instrument_id.asc');
    const rows = z.array(closeSchema).parse(await this.request(url));
    return rows.map((row) => ({ instrumentId: row.instrument_id as InstrumentId, tradingDate: isoDate(row.trading_date), close: decimalString(row.close), source: row.price_revisions.source, sourceRevision: row.price_revisions.source_revision }));
  }

  async listCorrections(input: { instrumentIds: InstrumentId[]; from: IsoDate; through: IsoDate }): Promise<PriceCorrection[]> {
    const ids = validatedInstrumentIds(input.instrumentIds);
    if (ids.length === 0) return [];
    const url = new URL('/rest/v1/price_corrections', this.baseUrl);
    url.searchParams.set('select', 'instrument_id,trading_date,corrected_close,evidence,correction_version');
    url.searchParams.set('instrument_id', `in.(${ids.join(',')})`);
    url.searchParams.append('trading_date', `gte.${input.from}`);
    url.searchParams.append('trading_date', `lte.${input.through}`);
    const rows = z.array(correctionSchema).parse(await this.request(url));
    return rows.map((row) => ({ instrumentId: row.instrument_id as InstrumentId, tradingDate: isoDate(row.trading_date), correctedClose: decimalString(row.corrected_close), evidence: row.evidence, correctionVersion: row.correction_version }));
  }

  async listValidatedCorporateActions(input: { instrumentIds: InstrumentId[]; from: IsoDate; through: IsoDate }): Promise<Array<CorporateAction & { effectiveDate: IsoDate }>> {
    const ids = validatedInstrumentIds(input.instrumentIds);
    if (ids.length === 0) return [];
    const url = new URL('/rest/v1/corporate_actions', this.baseUrl);
    url.searchParams.set('select', 'instrument_id,action_date,action_type,ratio_numerator,ratio_denominator,status');
    url.searchParams.set('instrument_id', `in.(${ids.join(',')})`);
    url.searchParams.append('action_date', `gte.${input.from}`);
    url.searchParams.append('action_date', `lte.${input.through}`);
    url.searchParams.set('status', 'eq.validated');
    const rows = z.array(actionSchema).parse(await this.request(url));
    return rows.map((row) => ({ instrumentId: row.instrument_id, type: 'split', status: 'validated', ratioNumerator: decimalString(row.ratio_numerator), ratioDenominator: decimalString(row.ratio_denominator), effectiveDate: isoDate(row.action_date) }));
  }

  async findPriceRevisionId(input: { source: DailyClose['source']; sourceRevision: string }): Promise<string | null> {
    if (input.source === 'manual_correction') return null;
    const url = new URL('/rest/v1/price_revisions', this.baseUrl);
    url.searchParams.set('select', 'id');
    url.searchParams.set('source', `eq.${input.source}`);
    url.searchParams.set('source_revision', `eq.${input.sourceRevision}`);
    url.searchParams.set('limit', '2');
    const rows = revisionIdSchema.parse(await this.request(url));
    if (rows.length > 1) throw new Error('Supabase returned duplicate price revisions.');
    return rows[0]?.id ?? null;
  }

  private async request(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` } });
    if (!response.ok) throw new Error(`Supabase report-input query failed with HTTP ${response.status}.`);
    return response.json();
  }
}

function validatedInstrumentIds(values: InstrumentId[]): string[] {
  const ids = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Report input contains an invalid instrument ID.');
  }
  return ids;
}
