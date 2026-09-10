import { describe, expect, it, vi } from 'vitest';
import { createCloudflareQueueHandler, type CloudflareQueueBatch } from './cloudflare';

function message(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('Cloudflare queue adapter', () => {
  it('resolves handlers through dependency injection and forwards a batch', async () => {
    const reportRecompute = vi.fn().mockResolvedValue(undefined);
    const resolveHandlers = vi.fn().mockResolvedValue({ reportRecompute });
    const current = message({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' });
    const batch: CloudflareQueueBatch = { messages: [current] };
    const environment = { name: 'test' };
    const executionContext = {} as ExecutionContext;

    const result = await createCloudflareQueueHandler(resolveHandlers)(batch, environment, executionContext);

    expect(result).toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(resolveHandlers).toHaveBeenCalledWith(environment, executionContext);
    expect(reportRecompute).toHaveBeenCalledWith({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' });
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it('keeps valid jobs retryable when no durable handler is configured', async () => {
    const current = message({ kind: 'price.refresh', symbols: ['AAPL'], date: '2026-09-10' });
    const result = await createCloudflareQueueHandler(() => ({}))({ messages: [current] }, {}, {} as ExecutionContext);

    expect(result).toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(current.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(current.ack).not.toHaveBeenCalled();
  });

  it('acknowledges malformed payloads as rejected poison messages', async () => {
    const current = message({ kind: 'unknown.job' });
    const result = await createCloudflareQueueHandler(() => ({}))({ messages: [current] }, {}, {} as ExecutionContext);

    expect(result).toEqual({ acknowledged: 0, retried: 0, rejected: 1 });
    expect(current.ack).toHaveBeenCalledOnce();
    expect(current.retry).not.toHaveBeenCalled();
  });
});
