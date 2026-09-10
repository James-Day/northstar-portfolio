import { describe, expect, it, vi } from 'vitest';
import { SupabaseMarketDataQuotaRepository } from '@/services/supabase/market-data-quota-repository';

describe('Supabase market-data quota repository', () => {
  it('reserves through the atomic RPC with a UTC month and idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ reservation_id: '11111111-1111-4111-8111-111111111111', reserved_units: 12 }]), { status: 200 }));
    const repository = new SupabaseMarketDataQuotaRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.reserve({ now: new Date('2026-09-10T23:00:00Z'), units: 12, monthlyCap: 100, idempotencyKey: 'daily:2026-09-10:run-1' })).resolves.toEqual({ reservationId: '11111111-1111-4111-8111-111111111111', units: 12 });
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/reserve_market_data_quota');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_month_start: '2026-09-01', p_units: 12, p_monthly_cap: 100, p_idempotency_key: 'daily:2026-09-10:run-1' });
  });

  it('reconciles a reservation and validates the returned accounting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ reservation_id: '11111111-1111-4111-8111-111111111111', reserved_units: 12, consumed_units: 10, released_units: 2 }]), { status: 200 }));
    const repository = new SupabaseMarketDataQuotaRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.reconcile({ reservationId: '11111111-1111-4111-8111-111111111111', consumedUnits: 10 })).resolves.toEqual({ reservation_id: '11111111-1111-4111-8111-111111111111', reserved_units: 12, consumed_units: 10, released_units: 2 });
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/reconcile_market_data_quota');
  });
});
