import { describe, expect, it, vi } from 'vitest';
import { SupabaseMarketDataJobRunsRepository } from '@/services/supabase/market-data-job-runs-repository';

describe('Supabase market-data job runs repository', () => {
  it('records a service-only run with operational counters', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]), { status: 201 }));
    const repository = new SupabaseMarketDataJobRunsRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.record({ tradingDate: '2026-07-06', status: 'persisted', attempts: 2, failedAttempts: 1, requestedSymbols: 8, persistedRows: 4, quotaUnits: 4 })).resolves.toBe('11111111-1111-4111-8111-111111111111');
    const request = fetcher.mock.calls[0][1];
    expect(request.headers.authorization).toBe('Bearer service-secret');
    expect(JSON.parse(request.body)).toMatchObject({ trading_date: '2026-07-06', status: 'persisted', attempts: 2, quota_units: 4 });
  });
});
