import { describe, expect, it } from 'vitest';
import { classifyPriceFreshness } from '@/services/market-data/stale-prices';

describe('price freshness', () => {
  it('distinguishes current, stale, and missing closes without inventing values', () => {
    expect(classifyPriceFreshness({ symbols: ['vti', 'AAPL', 'MSFT'], expectedDate: '2026-07-06' as never, latestBySymbol: { AAPL: '2026-07-06' as never, MSFT: '2026-07-03' as never, VTI: null } })).toEqual([
      { symbol: 'AAPL', expectedDate: '2026-07-06', latestDate: '2026-07-06', status: 'current' },
      { symbol: 'MSFT', expectedDate: '2026-07-06', latestDate: '2026-07-03', status: 'stale' },
      { symbol: 'VTI', expectedDate: '2026-07-06', latestDate: null, status: 'missing' },
    ]);
  });
});
