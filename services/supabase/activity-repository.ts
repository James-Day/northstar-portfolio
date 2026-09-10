import { z } from 'zod';

const activitySchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  effective_date: z.string(),
  entry_type: z.string(),
  instrument_id: z.string().uuid().nullable(),
  quantity: z.string().nullable(),
  unit_price: z.string().nullable(),
  cash_amount: z.string(),
  external_flow: z.boolean(),
  description: z.string(),
  source_row_id: z.string().uuid().nullable(),
  source_row: z.object({ row_number: z.number(), raw_row: z.record(z.string(), z.unknown()), parse_status: z.string(), message: z.string().nullable() }).nullable().optional(),
});

export type AccountActivity = {
  id: string;
  accountId: string;
  effectiveDate: string;
  entryType: string;
  instrumentId: string | null;
  quantity: string | null;
  unitPrice: string | null;
  cashAmount: string;
  externalFlow: boolean;
  description: string;
  sourceRowId: string | null;
  sourceRow: { rowNumber: number; rawRow: Record<string, unknown>; parseStatus: string; message: string | null } | null;
};

export type ActivityPage = { items: AccountActivity[]; limit: number; offset: number; hasMore: boolean };
export type ActivityRepositoryOptions = { supabaseUrl: string; anonKey: string; fetcher?: typeof fetch };

/** Reads immutable, account-scoped ledger activity through Supabase RLS. */
export class SupabaseActivityRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: ActivityRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.anonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for activity reads.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async list(accountId: string, accessToken: string, input: { limit?: number; offset?: number } = {}): Promise<ActivityPage> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Activity limit must be from 1 through 100.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Activity offset must be non-negative.');
    const url = new URL('/rest/v1/ledger_entries', this.baseUrl);
    url.searchParams.set('select', 'id,account_id,effective_date,entry_type,instrument_id,quantity,unit_price,cash_amount,external_flow,description,source_row_id,source_row:import_source_rows(row_number,raw_row,parse_status,message)');
    url.searchParams.set('account_id', 'eq.' + accountId);
    url.searchParams.set('order', 'effective_date.desc,created_at.desc,id.desc');
    url.searchParams.set('limit', String(limit + 1));
    url.searchParams.set('offset', String(offset));
    const response = await this.fetcher(url, { headers: { apikey: this.options.anonKey, authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Supabase activity query failed with HTTP ${response.status}.`);
    const rows = z.array(activitySchema).parse(await response.json());
    return { items: rows.slice(0, limit).map(toActivity), limit, offset, hasMore: rows.length > limit };
  }
}

function toActivity(row: z.infer<typeof activitySchema>): AccountActivity {
  return {
    id: row.id, accountId: row.account_id, effectiveDate: row.effective_date, entryType: row.entry_type,
    instrumentId: row.instrument_id, quantity: row.quantity, unitPrice: row.unit_price, cashAmount: row.cash_amount,
    externalFlow: row.external_flow, description: row.description, sourceRowId: row.source_row_id,
    sourceRow: row.source_row ? { rowNumber: row.source_row.row_number, rawRow: row.source_row.raw_row, parseStatus: row.source_row.parse_status, message: row.source_row.message } : null,
  };
}
