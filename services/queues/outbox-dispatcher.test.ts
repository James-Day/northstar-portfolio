import { describe, expect, it, vi } from 'vitest';
import { dispatchOutbox, type OutboxRecord, type OutboxRepository } from './outbox-dispatcher';

const now = () => new Date('2026-09-10T20:00:00.000Z');
function repository(events: OutboxRecord[]): OutboxRepository {
  return { claim: vi.fn().mockResolvedValue(events), complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue('retrying'), resolveAccountOwner: vi.fn().mockResolvedValue('user-1') };
}

describe('transactional outbox dispatcher', () => {
  it('claims, verifies ownership, publishes a typed job and completes after publish', async () => {
    const repo = repository([{ id: 'event-1', eventType: 'import.committed', payload: { accountId: 'account-1', importId: 'import-1' }, attempts: 1 }]);
    const publish = vi.fn().mockResolvedValue(undefined);
    await expect(dispatchOutbox({ repository: repo, publish, now })).resolves.toEqual({ claimed: 1, dispatched: 1, retried: 0, failed: 0, skipped: 0 });
    expect(publish).toHaveBeenCalledWith({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' }, 'job-outbox:event-1');
    expect(repo.complete).toHaveBeenCalledWith('event-1');
  });

  it('leaves publication failures retryable and never completes the row', async () => {
    const repo = repository([{ id: 'event-1', eventType: 'import.undone', payload: { accountId: 'account-1' }, attempts: 2 }]);
    const fail = repo.fail as ReturnType<typeof vi.fn>;
    const publish = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    await expect(dispatchOutbox({ repository: repo, publish, now })).resolves.toMatchObject({ claimed: 1, retried: 1 });
    expect(fail).toHaveBeenCalledWith('event-1', expect.objectContaining({ error: 'queue unavailable', maxAttempts: 8 }));
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('permanently fails unknown events and ownership mismatches', async () => {
    const repo = repository([
      { id: 'event-1', eventType: 'unknown', payload: { accountId: 'account-1' }, attempts: 8 },
      { id: 'event-2', eventType: 'import.committed', payload: { accountId: 'account-2', requestedBy: 'wrong-user' }, attempts: 8 },
    ]);
    (repo.fail as ReturnType<typeof vi.fn>).mockResolvedValue('failed');
    const result = await dispatchOutbox({ repository: repo, publish: vi.fn(), now });
    expect(result).toMatchObject({ claimed: 2, failed: 2, dispatched: 0 });
    expect(repo.resolveAccountOwner).toHaveBeenCalledTimes(1);
  });
});
