import { describe, expect, it, vi } from 'vitest';
import { runScheduledPriceRefresh } from '@/services/market-data/scheduled-refresh';

describe('scheduled price refresh composition', () => {
  it('loads one active-symbol set before running the guarded job', async () => {
    const symbols = { list: vi.fn().mockResolvedValue(['AAPL']) };
    const provider = { getDailyPrices: vi.fn().mockResolvedValue([{ symbol: 'AAPL', tradingDate: '2026-07-06', close: '100', provider: 'marketstack', providerMetadata: {} }]) };
    const persistence = { persist: vi.fn().mockResolvedValue({ upserted: 1 }) };
    const recorder = { record: vi.fn().mockResolvedValue('run-id') };
    await expect(runScheduledPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), { symbols, provider, persistence, recorder, retry: { sleep: vi.fn().mockResolvedValue(undefined) } })).resolves.toMatchObject({ status: 'persisted', requestedSymbols: ['AAPL'] });
    expect(symbols.list).toHaveBeenCalledOnce();
    expect(provider.getDailyPrices).toHaveBeenCalledWith(['AAPL'], '2026-07-06');
  });
});
