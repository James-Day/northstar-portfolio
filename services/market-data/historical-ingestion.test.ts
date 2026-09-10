import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type InstrumentId } from '@/lib/domain/types';
import { ingestDoltHubHistory, inspectHistoricalContinuity, prepareHistoricalPriceIngestion } from '@/services/market-data/historical-ingestion';

const alias = (symbol: string, instrumentId: string, from = '2020-01-01') => ({ instrumentId: instrumentId as InstrumentId, symbol, effectiveFrom: isoDate(from), effectiveTo: null });
const close = (symbol: string, date: string, value: string) => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub' as const, sourceRevision: 'rev-1' });

describe('historical price ingestion preparation', () => {
  it('maps effective aliases, preserves revision metadata, and deduplicates retries', () => {
    const result = prepareHistoricalPriceIngestion([close('aapl', '2024-01-02', '185.64'), close('AAPL', '2024-01-02', '185.6400')], [alias('AAPL', 'instrument-a')], 'rev-1');
    expect(result.accepted).toEqual([{ instrumentId: 'instrument-a', sourceSymbol: 'AAPL', tradingDate: '2024-01-02', close: '185.64', source: 'dolthub', sourceRevision: 'rev-1' }]);
    expect(result.quarantined).toHaveLength(0);
  });

  it('quarantines unknown aliases and suspicious closes without guessing', () => {
    const result = prepareHistoricalPriceIngestion([close('UNKNOWN', '2024-01-02', '10'), close('AAPL', '2024-01-02', '100'), close('AAPL', '2024-01-03', '1000')], [alias('AAPL', 'instrument-a')], 'rev-1');
    expect(result.accepted).toHaveLength(1);
    expect(result.quarantined).toEqual(expect.arrayContaining([
      expect.objectContaining({ record: expect.objectContaining({ symbol: 'UNKNOWN' }), reason: expect.stringContaining('No effective instrument alias') }),
      expect.objectContaining({ record: expect.objectContaining({ symbol: 'AAPL' }), reason: expect.stringContaining('changed') }),
    ]));
  });

  it('walks all source pages, persists mapped rows, and preserves one revision', async () => {
    const getDailyClosePage = vi.fn()
      .mockResolvedValueOnce({ records: [close('AAPL', '2024-01-02', '185.64')], sourceRevision: 'rev-1', nextCursor: { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' } })
      .mockResolvedValueOnce({ records: [close('AAPL', '2024-01-03', '186')], sourceRevision: 'rev-1', nextCursor: null });
    const persistDoltHubPage = vi.fn().mockResolvedValue({ revisionId: 'revision-id', upserted: 1 });
    await expect(ingestDoltHubHistory({ source: { getDailyClosePage }, persistence: { persistDoltHubPage }, symbols: ['AAPL'], from: isoDate('2024-01-02'), through: isoDate('2024-01-03'), aliases: [alias('AAPL', 'instrument-a')] })).resolves.toMatchObject({ sourceRevision: 'rev-1', pages: 2, upserted: 2, quarantined: [] });
    expect(getDailyClosePage).toHaveBeenCalledTimes(2);
    expect(getDailyClosePage.mock.calls[1][0].cursor).toEqual({ tradingDate: '2024-01-02', symbol: 'AAPL' });
    expect(persistDoltHubPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ sourceRevision: 'rev-1', records: [expect.objectContaining({ instrumentId: 'instrument-a' })] }));
  });

  it('fails closed when a later page reports a different source revision', async () => {
    const getDailyClosePage = vi.fn()
      .mockResolvedValueOnce({ records: [], sourceRevision: 'rev-1', nextCursor: { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' } })
      .mockResolvedValueOnce({ records: [], sourceRevision: 'rev-2', nextCursor: null });
    await expect(ingestDoltHubHistory({ source: { getDailyClosePage }, persistence: { persistDoltHubPage: vi.fn().mockResolvedValue({ revisionId: 'id', upserted: 0 }) }, symbols: ['AAPL'], from: isoDate('2024-01-02'), through: isoDate('2024-01-03'), aliases: [alias('AAPL', 'instrument-a')] })).rejects.toThrow('source revision changed');
  });

  it('reports a missing trading day and an alias gap without inventing a close', () => {
    const result = inspectHistoricalContinuity([
      close('AAPL', '2024-01-02', '185'),
      close('AAPL', '2024-01-04', '186'),
      close('OLD', '2024-01-03', '10'),
    ], [alias('AAPL', 'instrument-a')]);
    expect(result).toEqual(expect.arrayContaining([
      { symbol: 'AAPL', kind: 'missing_trading_dates', dates: ['2024-01-03'] },
      { symbol: 'OLD', kind: 'alias_gap', dates: ['2024-01-03'] },
    ]));
  });
});
