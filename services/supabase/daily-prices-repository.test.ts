import { describe, expect, it, vi } from 'vitest';
import { SupabaseDailyPricesRepository } from '@/services/supabase/daily-prices-repository';

describe('Supabase daily prices repository', () => {
  it('finds missing symbols without spending provider quota', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '11111111-1111-4111-8111-111111111111', symbol: 'AAPL' }, { instrument_id: '22222222-2222-4222-8222-222222222222', symbol: 'VTI' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 }));
    const repository = new SupabaseDailyPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.getMissingSymbols(['vti', 'AAPL'], '2026-07-06')).resolves.toEqual(['VTI']);
    expect(String(fetcher.mock.calls[1][0])).toContain('trading_date=eq.2026-07-06');
  });
  it('resolves symbols to effective instrument IDs before upserting', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', source: 'marketstack', source_revision: 'marketstack:2026-07-06' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: '22222222-2222-4222-8222-222222222222', symbol: 'AAPL', effective_from: '2020-01-01', effective_to: null }])))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const repository = new SupabaseDailyPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.persist({ tradingDate: '2026-07-06', prices: [{ symbol: 'AAPL', tradingDate: '2026-07-06' as never, close: '100' as never, provider: 'marketstack', providerMetadata: { requestedDate: '2026-07-06' } }] })).resolves.toEqual({ upserted: 1 });
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject([{ instrument_id: '22222222-2222-4222-8222-222222222222', trading_date: '2026-07-06' }]);
  });
});
