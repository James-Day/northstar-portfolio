import { describe, expect, it, vi } from 'vitest';
import { SupabaseHistoricalPricesRepository } from '@/services/supabase/historical-prices-repository';

describe('Supabase historical prices repository', () => {
  it('reuses a revision and upserts a page idempotently', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', source: 'dolthub', source_revision: 'rev-1' }])))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const repository = new SupabaseHistoricalPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.persistDoltHubPage({ sourceRevision: 'rev-1', records: [{ instrumentId: 'instrument-a' as never, tradingDate: '2024-01-02' as never, close: '185.64' as never, source: 'dolthub', sourceRevision: 'rev-1' }] })).resolves.toEqual({ revisionId: '11111111-1111-4111-8111-111111111111', upserted: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0].searchParams.get('on_conflict')).toBe('source,source_revision');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual([{ instrument_id: 'instrument-a', trading_date: '2024-01-02', close: '185.64', price_revision_id: '11111111-1111-4111-8111-111111111111' }]);
  });

  it('does not issue a daily-price request for an empty page', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', source: 'dolthub', source_revision: 'rev-1' }])));
    const repository = new SupabaseHistoricalPricesRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.persistDoltHubPage({ sourceRevision: 'rev-1', records: [] })).resolves.toMatchObject({ upserted: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
