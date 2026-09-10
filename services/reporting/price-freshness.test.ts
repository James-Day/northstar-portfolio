import { describe, expect, it } from 'vitest';
import { buildPriceFreshnessReport } from '@/services/reporting/price-freshness';

describe('report price freshness composition', () => {
  it('joins instrument IDs to symbols and preserves missing prices', () => {
    expect(buildPriceFreshnessReport({ instruments: [{ instrumentId: '11111111-1111-4111-8111-111111111111' as never, symbol: 'AAPL' }, { instrumentId: '22222222-2222-4222-8222-222222222222' as never, symbol: 'VTI' }], expectedDate: '2026-07-06' as never, latestByInstrument: { '11111111-1111-4111-8111-111111111111': '2026-07-06' as never } })).toEqual([
      { symbol: 'AAPL', expectedDate: '2026-07-06', latestDate: '2026-07-06', status: 'current' },
      { symbol: 'VTI', expectedDate: '2026-07-06', latestDate: null, status: 'missing' },
    ]);
  });
});
