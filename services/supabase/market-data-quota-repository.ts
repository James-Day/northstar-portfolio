import { z } from 'zod';
import { validateQuotaReservationInput, validateQuotaUnits, type MarketDataQuotaLedger, type QuotaReconciliation, type QuotaReservation } from '@/services/market-data/quota';

const reservationSchema = z.object({ reservation_id: z.string().uuid(), reserved_units: z.number().int().nonnegative() });
const reconciliationSchema = z.object({ reservation_id: z.string().uuid(), reserved_units: z.number().int().nonnegative(), consumed_units: z.number().int().nonnegative(), released_units: z.number().int().nonnegative() });

export type SupabaseMarketDataQuotaRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Calls the service-only atomic quota RPCs. Provider keys never enter this repository. */
export class SupabaseMarketDataQuotaRepository implements MarketDataQuotaLedger {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseMarketDataQuotaRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for market-data quota writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async reserve(input: { now: Date; units: number; monthlyCap: number; idempotencyKey: string }): Promise<QuotaReservation> {
    validateQuotaReservationInput(input);
    const response = await this.call('reserve_market_data_quota', {
      p_month_start: monthStart(input.now), p_units: input.units, p_monthly_cap: input.monthlyCap, p_idempotency_key: input.idempotencyKey,
    });
    const row = reservationSchema.array().parse(await response.json())[0];
    if (!row) throw new Error('Supabase did not return a market-data quota reservation.');
    return { reservationId: row.reservation_id, units: row.reserved_units };
  }

  async reconcile(input: { reservationId: string; consumedUnits: number }): Promise<QuotaReconciliation> {
    validateQuotaUnits(input.consumedUnits, 'Consumed quota units');
    if (!input.reservationId.trim()) throw new Error('Quota reservation ID is required.');
    const response = await this.call('reconcile_market_data_quota', { p_reservation_id: input.reservationId, p_consumed_units: input.consumedUnits });
    const row = reconciliationSchema.array().parse(await response.json())[0];
    if (!row) throw new Error('Supabase did not return a quota reconciliation.');
    return { reservationId: row.reservation_id, reservedUnits: row.reserved_units, consumedUnits: row.consumed_units, releasedUnits: row.released_units };
  }

  private async call(functionName: string, body: Record<string, unknown>) {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${functionName}`, this.baseUrl), {
      method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Supabase ${functionName} failed with HTTP ${response.status}.`);
    return response;
  }
}

function monthStart(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('Quota reservation requires a valid date.');
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
