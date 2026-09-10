import { describe, expect, it, vi } from 'vitest';
import { SupabasePriceFreshnessReportRepository } from '@/services/supabase/price-freshness-report-repository';

describe('Supabase price freshness report repository', () => {
  it('enforces account ownership and composes stored freshness rows', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', user_id: '99999999-9999-4999-8999-999999999999' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '22222222-2222-4222-8222-222222222222' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '22222222-2222-4222-8222-222222222222', symbol: 'AAPL', effective_from: '2020-01-01', effective_to: null }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '22222222-2222-4222-8222-222222222222', trading_date: '2026-07-06' }])));
    const repository = new SupabasePriceFreshnessReportRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch, clock: () => new Date('2026-07-06T22:00:00Z') });
    await expect(repository.get('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'ignored')).resolves.toEqual({ expectedDate: '2026-07-06', rows: [{ symbol: 'AAPL', expectedDate: '2026-07-06', latestDate: '2026-07-06', status: 'current' }] });
  });

  it('returns no report for an account owned by another user', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', user_id: '99999999-9999-4999-8999-999999999999' }])));
    const repository = new SupabasePriceFreshnessReportRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.get('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'ignored')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
