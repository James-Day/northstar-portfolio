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

  it('uses a canonical revision for the same prices regardless of symbol order', async () => {
    const revisionBodies: unknown[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_input);
      if (url.includes('/price_revisions')) {
        revisionBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', source: 'marketstack', source_revision: 'ignored' }]), { status: 200 });
      }
      if (url.includes('/instrument_aliases')) return new Response(JSON.stringify([
        { instrument_id: '22222222-2222-4222-8222-222222222222', symbol: 'AAPL', effective_from: '2020-01-01', effective_to: null },
        { instrument_id: '33333333-3333-4333-8333-333333333333', symbol: 'MSFT', effective_from: '2020-01-01', effective_to: null },
      ]), { status: 200 });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const repository = new SupabaseDailyPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher });
    const prices = [
      { symbol: 'MSFT', tradingDate: '2026-07-06' as never, close: '200' as never, provider: 'marketstack' as const, providerMetadata: { requestedDate: '2026-07-06' } },
      { symbol: 'AAPL', tradingDate: '2026-07-06' as never, close: '100' as never, provider: 'marketstack' as const, providerMetadata: { requestedDate: '2026-07-06' } },
    ];
    await repository.persist({ tradingDate: '2026-07-06', prices });
    await repository.persist({ tradingDate: '2026-07-06', prices: [...prices].reverse() });
    expect(revisionBodies[0]).toEqual(revisionBodies[1]);
  });

  it('rejects mixed dates and duplicate symbols before creating a revision', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const repository = new SupabaseDailyPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher });
    const price = { symbol: 'AAPL', tradingDate: '2026-07-07' as never, close: '100' as never, provider: 'marketstack' as const, providerMetadata: {} };
    await expect(repository.persist({ tradingDate: '2026-07-06', prices: [price] })).rejects.toThrow('different from the requested');
    await expect(repository.persist({ tradingDate: '2026-07-06', prices: [{ ...price, tradingDate: '2026-07-06' as never }, { ...price, tradingDate: '2026-07-06' as never }] })).rejects.toThrow('duplicate symbols');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed ticker symbols before constructing an alias filter', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const repository = new SupabaseDailyPricesRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher });

    await expect(repository.getMissingSymbols(['AAPL,MSFT'], '2026-07-06')).rejects.toThrow('invalid ticker symbol');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
