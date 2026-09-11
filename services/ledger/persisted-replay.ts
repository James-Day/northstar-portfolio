import { z } from 'zod';
import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import { isoDate, type IsoDate } from '@/lib/domain/types';
import type { LedgerEvent, LotInput } from '@/services/ledger/fifo';

const decimalText = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const rowSchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  effective_date: z.string(),
  entry_type: z.enum(['buy', 'sell', 'dividend', 'drip_buy', 'interest', 'fee', 'deposit', 'withdrawal', 'ira_incentive', 'transfer_in', 'transfer_out', 'opening_cash', 'opening_position']),
  instrument_id: z.string().uuid().nullable(),
  quantity: decimalText.nullable(),
  unit_price: decimalText.nullable(),
  cash_amount: decimalText,
  description: z.string(),
});

const accountSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid() });

export type PersistedLedgerReplay = {
  events: LedgerEvent[];
  openingLots: LotInput[];
  activityCoveredThrough: IsoDate | null;
  /** IDs are exposed so report jobs can derive an immutable import-state revision. */
  sourceEntryIds: string[];
};

export type SupabaseLedgerReplayRepositoryOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
};

/**
 * Loads the committed ledger projection as calculation input. Undo keeps source
 * rows for audit, so the joined committed-import filter is essential: replaying
 * every ledger row would resurrect an undone import.
 */
export class SupabaseLedgerReplayRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SupabaseLedgerReplayRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for ledger replay.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async get(accountId: string, userId: string): Promise<PersistedLedgerReplay | undefined> {
    const accountUrl = new URL('/rest/v1/accounts', this.baseUrl);
    accountUrl.searchParams.set('select', 'id,user_id');
    accountUrl.searchParams.set('id', `eq.${accountId}`);
    const accountResponse = await this.fetcher(accountUrl, { headers: this.headers() });
    if (!accountResponse.ok) throw new Error(`Supabase account ownership query failed with HTTP ${accountResponse.status}.`);
    const account = z.array(accountSchema).parse(await accountResponse.json())[0];
    if (!account || account.user_id !== userId) return undefined;

    const ledgerUrl = new URL('/rest/v1/ledger_entries', this.baseUrl);
    ledgerUrl.searchParams.set('select', 'id,account_id,effective_date,entry_type,instrument_id,quantity,unit_price,cash_amount,description,imports!inner(status)');
    ledgerUrl.searchParams.set('account_id', `eq.${accountId}`);
    ledgerUrl.searchParams.set('imports.status', 'eq.committed');
    ledgerUrl.searchParams.set('order', 'effective_date.asc,id.asc');
    const ledgerResponse = await this.fetcher(ledgerUrl, { headers: this.headers() });
    if (!ledgerResponse.ok) throw new Error(`Supabase ledger replay query failed with HTTP ${ledgerResponse.status}.`);
    const rows = z.array(rowSchema).parse(await ledgerResponse.json());
    const events: LedgerEvent[] = [];
    const openingLots: LotInput[] = [];
    for (const row of rows) {
      if (row.entry_type === 'opening_position') {
        if (!row.instrument_id || !row.quantity) throw new Error(`Opening position ${row.id} is missing instrument or quantity.`);
        const quantity = positive(row.quantity, 'Opening position quantity');
        const totalCostBasis = row.unit_price === null ? null : decimalString(new Decimal(quantity).times(nonNegative(row.unit_price, 'Opening position unit price')).toFixed());
        openingLots.push({ id: row.id, instrumentId: row.instrument_id, acquiredOn: isoDate(row.effective_date), quantity, totalCostBasis });
        continue;
      }
      events.push(toLedgerEvent(row));
    }
    return {
      events,
      openingLots,
      activityCoveredThrough: rows.length ? isoDate(rows.reduce((latest, row) => row.effective_date > latest ? row.effective_date : latest, rows[0].effective_date)) : null,
      sourceEntryIds: rows.map((row) => row.id),
    };
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
}

function positive(value: string, label: string): DecimalString {
  const result = decimalString(value);
  if (new Decimal(result).lte(0)) throw new Error(`${label} must be greater than zero.`);
  return result;
}

function nonNegative(value: string, label: string): DecimalString {
  const result = decimalString(value);
  if (new Decimal(result).lt(0)) throw new Error(`${label} cannot be negative.`);
  return result;
}

function magnitude(value: string): DecimalString { return decimalString(value).replace('-', '') as DecimalString; }

function toLedgerEvent(row: z.infer<typeof rowSchema>): LedgerEvent {
  const date = isoDate(row.effective_date);
  const amount = magnitude(row.cash_amount);
  const type = row.entry_type as Exclude<z.infer<typeof rowSchema>['entry_type'], 'opening_position'>;
  if (row.entry_type === 'dividend') return { id: row.id, date, type: 'dividend', instrumentId: row.instrument_id ?? undefined, amount };
  if (row.entry_type === 'buy' || row.entry_type === 'drip_buy' || row.entry_type === 'sell') {
    if (!row.instrument_id || !row.quantity) throw new Error(`Ledger entry ${row.id} is missing instrument or quantity.`);
    const quantity = positive(row.quantity, `${row.entry_type} quantity`);
  if (row.entry_type === 'sell') return { id: row.id, date, type: 'sell', instrumentId: row.instrument_id, quantity, grossAmount: amount, fee: decimalString('0') };
    return { id: row.id, date, type: row.entry_type, instrumentId: row.instrument_id, quantity, grossAmount: amount, fee: decimalString('0') };
  }
  if (row.entry_type === 'fee') return { id: row.id, date, type: 'fee', amount };
  return { id: row.id, date, type, amount } as LedgerEvent;
}
