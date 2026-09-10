import { describe, expect, it, vi } from 'vitest';
import { handleScheduledOutboxDispatch, runScheduledOutboxDispatch, type QueueProducer } from './scheduled-outbox';
import type { OutboxRecord, OutboxRepository } from './outbox-dispatcher';

function repository(): OutboxRepository {
  return {
    claim: vi.fn().mockResolvedValue([{ id: 'event-1', eventType: 'import.committed', payload: { accountId: 'account-1' }, attempts: 1 } satisfies OutboxRecord]),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue('retrying'),
    resolveAccountOwner: vi.fn().mockResolvedValue('user-1'),
  };
}

describe('scheduled outbox adapter', () => {
  it('publishes claimed work through the report queue and completes it', async () => {
    const repo = repository();
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(runScheduledOutboxDispatch({ repository: repo, reportQueue: { send } satisfies QueueProducer })).resolves.toMatchObject({ claimed: 1, dispatched: 1 });
    expect(send).toHaveBeenCalledWith({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' });
    expect(repo.complete).toHaveBeenCalledWith('event-1');
  });

  it('registers dispatch with waitUntil so cron completion cannot abandon it', async () => {
    const waitUntil = vi.fn();
    handleScheduledOutboxDispatch({ waitUntil }, { repository: repository(), reportQueue: { send: vi.fn().mockResolvedValue(undefined) } });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0]).resolves.toMatchObject({ claimed: 1 });
  });
});
