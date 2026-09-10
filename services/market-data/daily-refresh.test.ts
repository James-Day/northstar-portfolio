import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { prepareDailyPriceRefresh, runAndRecordDailyPriceRefresh, runDailyPriceRefresh, runDailyPriceRefreshWithRetry } from '@/services/market-data/daily-refresh';
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

  it('does not spend provider quota when the durable monthly cap would be exceeded', async () => {
    const getDailyPrices = vi.fn();
    const provider: DailyPriceProvider = { getDailyPrices };
    const quota = { monthlyCap: 100, getUsedUnits: vi.fn().mockResolvedValue(99) };
    await expect(prepareDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', 'VTI'], provider, quota)).resolves.toEqual({ status: 'skipped', reason: 'quota_exhausted' });
    expect(getDailyPrices).not.toHaveBeenCalled();
  });

  it('rejects incomplete, duplicate, off-date, and unrequested provider results', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockResolvedValue([price('AAPL')]) };
    await expect(prepareDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', 'VTI'], provider)).rejects.toThrow('VTI');
  });

  it('persists one complete shared-symbol batch after the session guard', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockResolvedValue([price('AAPL')]) };
    const persistence = { persist: vi.fn().mockResolvedValue({ upserted: 1 }) };
    await expect(runDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', ' aapl '], provider, persistence)).resolves.toEqual({ status: 'persisted', tradingDate: '2026-07-06', requestedSymbols: ['AAPL'], upserted: 1 });
    expect(persistence.persist).toHaveBeenCalledWith({ tradingDate: '2026-07-06', prices: [price('AAPL')] });
  });

  it('skips symbols that already have a durable close for the trading date', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockResolvedValue([]) };
    const persistence = {
      getMissingSymbols: vi.fn().mockResolvedValue([]),
      persist: vi.fn(),
    };
    await expect(runDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL'], provider, persistence)).resolves.toEqual({ status: 'skipped', reason: 'already_fetched' });
    expect(persistence.getMissingSymbols).toHaveBeenCalledWith(['AAPL'], '2026-07-06');
    expect(provider.getDailyPrices).not.toHaveBeenCalled();
    expect(persistence.persist).not.toHaveBeenCalled();
  });

  it('requests only symbols missing from the durable daily-price cache', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockResolvedValue([price('VTI')]) };
    const persistence = {
      getMissingSymbols: vi.fn().mockResolvedValue(['VTI']),
      persist: vi.fn().mockResolvedValue({ upserted: 1 }),
    };
    await expect(runDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', 'VTI'], provider, persistence)).resolves.toMatchObject({ status: 'persisted', requestedSymbols: ['VTI'] });
    expect(provider.getDailyPrices).toHaveBeenCalledWith(['VTI'], '2026-07-06');
  });

  it('does not persist when the date is not eligible', async () => {
    const persistence = { persist: vi.fn() };
    await expect(runDailyPriceRefresh(new Date('2026-07-04T22:00:00.000Z'), ['AAPL'], { getDailyPrices: vi.fn() }, persistence)).resolves.toEqual({ status: 'skipped', reason: 'before_close_or_non_trading_day' });
    expect(persistence.persist).not.toHaveBeenCalled();
  });

  it('retries transient provider failures with exponential delays', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce([price('AAPL')]) };
    const persistence = { persist: vi.fn().mockResolvedValue({ upserted: 1 }) };
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(runDailyPriceRefreshWithRetry(new Date('2026-07-06T22:00:00.000Z'), ['AAPL'], provider, persistence, { baseDelayMs: 25, sleep })).resolves.toMatchObject({ status: 'persisted', upserted: 1 });
    expect(sleep).toHaveBeenCalledWith(25);
    expect(provider.getDailyPrices).toHaveBeenCalledTimes(2);
  });

  it('emits attempt, failure, and persistence telemetry', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce([price('AAPL')]) };
    const persistence = { persist: vi.fn().mockResolvedValue({ upserted: 1 }) };
    const telemetry = { record: vi.fn() };
    await runDailyPriceRefreshWithRetry(new Date('2026-07-06T22:00:00.000Z'), ['AAPL'], provider, persistence, { sleep: vi.fn().mockResolvedValue(undefined) }, telemetry);
    expect(telemetry.record.mock.calls.map(([event]) => event.type)).toEqual(['attempt', 'requested', 'failed', 'attempt', 'requested', 'persisted']);
  });

  it('records one durable outcome after a retried refresh', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce([price('AAPL')]) };
    const persistence = { persist: vi.fn().mockResolvedValue({ upserted: 1 }) };
    const recorder = { record: vi.fn().mockResolvedValue('run-id') };
    await expect(runAndRecordDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL'], provider, persistence, recorder, { sleep: vi.fn().mockResolvedValue(undefined) })).resolves.toMatchObject({ status: 'persisted' });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'persisted', attempts: 2, failedAttempts: 1, requestedSymbols: 2, quotaUnits: 2, persistedRows: 1 }));
  });

  it('records zero quota units when the durable cache makes the run a skip', async () => {
    const provider: DailyPriceProvider = { getDailyPrices: vi.fn() };
    const persistence = { getMissingSymbols: vi.fn().mockResolvedValue([]), persist: vi.fn() };
    const recorder = { record: vi.fn().mockResolvedValue('run-id') };
    await expect(runAndRecordDailyPriceRefresh(new Date('2026-07-06T22:00:00.000Z'), ['AAPL', 'MSFT'], provider, persistence, recorder)).resolves.toEqual({ status: 'skipped', reason: 'already_fetched' });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', attempts: 1, requestedSymbols: 0, quotaUnits: 0, persistedRows: 0 }));
    expect(provider.getDailyPrices).not.toHaveBeenCalled();
  });
});
