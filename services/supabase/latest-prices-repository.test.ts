import { describe, expect, it, vi } from 'vitest';
import { SupabaseLatestPricesRepository } from '@/services/supabase/latest-prices-repository';

describe('Supabase latest prices repository', () => {
  it('returns the newest stored date per instrument and preserves missing IDs', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { instrument_id: '11111111-1111-4111-8111-111111111111', trading_date: '2026-07-06' },
      { instrument_id: '11111111-1111-4111-8111-111111111111', trading_date: '2026-07-03' },
    ])));
    const repository = new SupabaseLatestPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.listLatest(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'])).resolves.toEqual({ '11111111-1111-4111-8111-111111111111': '2026-07-06', '22222222-2222-4222-8222-222222222222': null });
    expect(fetcher.mock.calls[0][0].searchParams.get('order')).toBe('trading_date.desc');
  });
});
