import { describe, expect, it, vi } from 'vitest';
import { handleScheduledRefresh } from '@/workers/scheduled-refresh';

describe('Cloudflare scheduled refresh adapter', () => {
  it('passes the scheduled timestamp to the refresh composition through waitUntil', async () => {
    const symbols = { list: vi.fn().mockResolvedValue([]) };
    const context = { waitUntil: vi.fn() };
    handleScheduledRefresh({ scheduledTime: Date.parse('2026-07-04T22:00:00.000Z') }, context, { symbols, provider: { getDailyPrices: vi.fn() }, persistence: { persist: vi.fn() }, recorder: { record: vi.fn().mockResolvedValue('run') } });
    expect(context.waitUntil).toHaveBeenCalledOnce();
    await expect(context.waitUntil.mock.calls[0][0]).resolves.toEqual({ status: 'skipped', reason: 'before_close_or_non_trading_day' });
  });
});
