import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { prepareDailyPriceRefresh } from '@/services/market-data/daily-refresh';
import type { DailyPriceProvider } from '@/services/market-data/types';

const price = (symbol: string) => ({ symbol, tradingDate: isoDate('2026-07-06'), close: decimalString('100'), provider: 'marketstack' as const, providerMetadata: {} });

describe('daily price refresh preparation', () => {
  it('coalesces symbols across users and makes one date-specific provider request', async () => {
    const getDailyPrices = vi.fn().mockResolvedValue([price('AAPL'), price('VTI')]);
    const provider: DailyPriceProvider = { getDailyPrices };

    await expect(prepareDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['vti', 'AAPL', ' VTI '], provider)).resolves.toMatchObject({
      status: 'ready_to_persist', tradingDate: '2026-07-06', requestedSymbols: ['AAPL', 'VTI'],
    });
    expect(getDailyPrices).toHaveBeenCalledWith(['AAPL', 'VTI'], '2026-07-06');
  });

  it('does not call the provider outside an eligible market session', async () => {
    const getDailyPrices = vi.fn();
    const provider: DailyPriceProvider = { getDailyPrices };

    await expect(prepareDailyPriceRefresh(new Date('2026-07-04T22:00:00.000Z'), ['AAPL'], provider)).resolves.toEqual({ status: 'skipped', reason: 'before_close_or_non_trading_day' });
    expect(getDailyPrices).not.toHaveBeenCalled();
  });

  it('rejects incomplete, duplicate, off-date, and unrequested provider results', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockResolvedValue([price('AAPL')]) };
    await expect(prepareDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', 'VTI'], provider)).rejects.toThrow('VTI');
  });
});
