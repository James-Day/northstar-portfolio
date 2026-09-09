import { describe, expect, it, vi } from 'vitest';
import { isoDate } from '@/lib/domain/types';
import { DoltHubHistoricalSource } from '@/services/market-data/dolthub';

const success = (rows: Array<Record<string, unknown>>) => new Response(JSON.stringify({
  query_execution_status: 'Success',
  query_execution_message: '',
  repository_owner: 'post-no-preference',
  repository_name: 'stocks',
  commit_ref: 'master',
  rows,
}));

describe('DoltHub historical-price source', () => {
  it('returns normalized unadjusted closes with the observed source revision', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-1' }]))
      .mockResolvedValueOnce(success([{ date: '2024-01-02', act_symbol: 'aapl', close: '185.6400' }]))
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-1' }]));
    const source = new DoltHubHistoricalSource({ fetcher: fetcher as typeof fetch, baseUrl: 'https://dolt.test/stocks' });

    await expect(source.getDailyClosePage({ symbols: ['AAPL', ' aapl '], from: isoDate('2024-01-02'), through: isoDate('2024-01-02') })).resolves.toEqual({
      sourceRevision: 'revision-1',
      records: [{ symbol: 'AAPL', tradingDate: '2024-01-02', close: '185.64', source: 'dolthub', sourceRevision: 'revision-1' }],
      nextCursor: null,
    });
    expect(fetcher.mock.calls[1][0].searchParams.get('q')).toContain("act_symbol IN ('AAPL')");
  });

  it('uses the last date and symbol as a resumable cursor for a full page', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-1' }]))
      .mockResolvedValueOnce(success([{ date: '2024-01-02', act_symbol: 'AAPL', close: '185.64' }]))
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-1' }]));
    const source = new DoltHubHistoricalSource({ fetcher: fetcher as typeof fetch, baseUrl: 'https://dolt.test/stocks' });

    await expect(source.getDailyClosePage({
      symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), limit: 1,
      cursor: { tradingDate: isoDate('2024-01-01'), symbol: 'AAPL' },
    })).resolves.toMatchObject({ nextCursor: { tradingDate: '2024-01-02', symbol: 'AAPL' } });
    expect(fetcher.mock.calls[1][0].searchParams.get('q')).toContain("act_symbol > 'AAPL'");
  });

  it('rejects a page when DoltHub changes revision during the read', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-1' }]))
      .mockResolvedValueOnce(success([{ date: '2024-01-02', act_symbol: 'AAPL', close: '185.64' }]))
      .mockResolvedValueOnce(success([{ commit_hash: 'revision-2' }]));
    const source = new DoltHubHistoricalSource({ fetcher: fetcher as typeof fetch, baseUrl: 'https://dolt.test/stocks' });

    await expect(source.getDailyClosePage({ symbols: ['AAPL'], from: isoDate('2024-01-02'), through: isoDate('2024-01-02') })).rejects.toThrow('changed during');
  });

  it('rejects invalid symbols and unsafe page bounds before issuing a query', async () => {
    const fetcher = vi.fn();
    const source = new DoltHubHistoricalSource({ fetcher: fetcher as typeof fetch, baseUrl: 'https://dolt.test/stocks' });

    await expect(source.getDailyClosePage({ symbols: ["AAPL'; DROP TABLE ohlcv;--"], from: isoDate('2024-01-02'), through: isoDate('2024-01-02') })).rejects.toThrow('Invalid market-data symbol');
    await expect(source.getDailyClosePage({ symbols: ['AAPL'], from: isoDate('2024-01-03'), through: isoDate('2024-01-02') })).rejects.toThrow('must end');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
