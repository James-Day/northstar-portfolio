import { describe, expect, it, vi } from 'vitest';
import { consumePriceQueueBatch } from '@/services/market-data/price-queue-runtime';

describe('price queue runtime', () => {
  it('resolves server-only dependencies and acknowledges a valid refresh job', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const ack = vi.fn();
    const result = await consumePriceQueueBatch(
      { messages: [{ body: { kind: 'price.refresh', symbols: ['AAPL'], date: '2026-09-10' }, ack, retry: vi.fn() }] },
      { secret: 'server-only' },
      {} as ExecutionContext,
      async (environment) => {
        expect(environment).toEqual({ secret: 'server-only' });
        return { refresh };
      },
    );
    expect(result).toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(refresh).toHaveBeenCalledWith({ kind: 'price.refresh', symbols: ['AAPL'], date: '2026-09-10' });
    expect(ack).toHaveBeenCalledOnce();
  });

  it('retries when the resolved refresh fails', async () => {
    const retry = vi.fn();
    const result = await consumePriceQueueBatch(
      { messages: [{ body: { kind: 'price.refresh', symbols: ['AAPL'], date: '2026-09-10' }, ack: vi.fn(), retry }] },
      {},
      {} as ExecutionContext,
      async () => ({ refresh: async () => { throw new Error('provider unavailable'); } }),
    );
    expect(result).toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });
});
