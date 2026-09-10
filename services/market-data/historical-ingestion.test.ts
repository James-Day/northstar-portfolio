import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type InstrumentId } from '@/lib/domain/types';
import { prepareHistoricalPriceIngestion } from '@/services/market-data/historical-ingestion';

const alias = (symbol: string, instrumentId: string, from = '2020-01-01') => ({ instrumentId: instrumentId as InstrumentId, symbol, effectiveFrom: isoDate(from), effectiveTo: null });
const close = (symbol: string, date: string, value: string) => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub' as const, sourceRevision: 'rev-1' });

describe('historical price ingestion preparation', () => {
  it('maps effective aliases, preserves revision metadata, and deduplicates retries', () => {
    const result = prepareHistoricalPriceIngestion([close('aapl', '2024-01-02', '185.64'), close('AAPL', '2024-01-02', '185.6400')], [alias('AAPL', 'instrument-a')], 'rev-1');
    expect(result.accepted).toEqual([{ instrumentId: 'instrument-a', tradingDate: '2024-01-02', close: '185.64', source: 'dolthub', sourceRevision: 'rev-1' }]);
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
});
