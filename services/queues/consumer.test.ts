import { describe, expect, it, vi } from 'vitest';
import { consumeQueueMessages } from './consumer';

function message(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('queue consumer', () => {
  it('acknowledges validated jobs after the matching handler succeeds', async () => {
    const importProcess = vi.fn().mockResolvedValue(undefined);
    const current = message({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' });
    await expect(consumeQueueMessages([current], { importProcess })).resolves.toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(importProcess).toHaveBeenCalledWith({ kind: 'import.process', importId: 'import-1', accountId: 'account-1', requestedBy: 'user-1' });
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it('retries handler failures and jobs without a configured handler', async () => {
    const failed = message({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'price_updated' });
    const unavailable = message({ kind: 'price.refresh', symbols: ['AAPL'], date: '2026-09-10' });
    await expect(consumeQueueMessages([failed, unavailable], { reportRecompute: vi.fn().mockRejectedValue(new Error('temporary')) })).resolves.toEqual({ acknowledged: 0, retried: 2, rejected: 0 });
    expect(failed.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(unavailable.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it('acknowledges malformed payloads as rejected poison messages', async () => {
    const invalid = message({ kind: 'unknown.job' });
    await expect(consumeQueueMessages([invalid], {})).resolves.toEqual({ acknowledged: 0, retried: 0, rejected: 1 });
    expect(invalid.ack).toHaveBeenCalledOnce();
    expect(invalid.retry).not.toHaveBeenCalled();
  });

  it('redacts credential-shaped queue evidence before durable persistence', async () => {
    const invalid = message({ kind: 'unknown.job', access_token: 'secret-token', nested: { authorization: 'Bearer hidden' } });
    const record = vi.fn().mockResolvedValue(undefined);
    await consumeQueueMessages([invalid], {}, { failureRecorder: { record }, queueName: 'imports' });
    const evidence = record.mock.calls[0][0];
    expect(evidence.payload).toEqual({ kind: 'unknown.job', access_token: '[REDACTED]', nested: { authorization: '[REDACTED]' } });
    expect(JSON.stringify(evidence)).not.toContain('hidden');
    expect(JSON.stringify(evidence)).not.toContain('secret-token');
  });
});
