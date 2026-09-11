import { describe, expect, it, vi } from 'vitest';
import { runScheduledPriceRefresh } from '@/services/market-data/scheduled-refresh';
import { MemoryRefreshClaimStore } from '@/services/market-data/refresh-claim-store';
import { isoDate } from '@/lib/domain/types';
import { decimalString } from '@/lib/domain/money';
import type { DailyPrice } from '@/services/market-data/types';

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

  it('prevents overlapping refreshes from sharing a symbol/date claim', async () => {
    const claimStore = new MemoryRefreshClaimStore();
    let releaseProvider!: () => void;
    const provider = { getDailyPrices: vi.fn(() => new Promise<DailyPrice[]>((resolve) => { releaseProvider = () => resolve([{ symbol: 'AAPL', tradingDate: isoDate('2026-07-06'), close: decimalString('100'), provider: 'marketstack', providerMetadata: {} }]); })) };
    const base = { symbols: { list: vi.fn().mockResolvedValue(['AAPL']) }, provider, persistence: { persist: vi.fn().mockResolvedValue({ upserted: 1 }) }, recorder: { record: vi.fn().mockResolvedValue('run') }, claimStore };
    const first = runScheduledPriceRefresh(new Date('2026-07-06T22:00:00Z'), base);
    await vi.waitFor(() => expect(provider.getDailyPrices).toHaveBeenCalledTimes(1));
    await expect(runScheduledPriceRefresh(new Date('2026-07-06T22:00:00Z'), base)).resolves.toEqual({ status: 'skipped', reason: 'already_running' });
    releaseProvider();
    await expect(first).resolves.toMatchObject({ status: 'persisted' });
  });
});
