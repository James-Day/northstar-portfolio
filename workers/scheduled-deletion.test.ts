import { describe, expect, it, vi } from 'vitest';
import type { DeletionSideEffects } from '@/services/privacy/deletion-executor';
import { runScheduledDeletion, handleScheduledDeletion } from './scheduled-deletion';

const effects: DeletionSideEffects = {
  deletePrivateObject: vi.fn().mockResolvedValue(undefined),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
  deleteReportSnapshots: vi.fn().mockResolvedValue(undefined),
  deleteProfile: vi.fn().mockResolvedValue(undefined),
  cancelBillingCustomer: vi.fn().mockResolvedValue(undefined),
  deleteAuthUser: vi.fn().mockResolvedValue(undefined),
};

describe('scheduled deletion adapter', () => {
  it('passes a deterministic scheduled timestamp into the durable executor', async () => {
    const repository = { claim: vi.fn().mockResolvedValue([]), complete: vi.fn(), fail: vi.fn() };
    await expect(runScheduledDeletion(new Date('2026-09-12T01:00:00Z'), { repository, effects })).resolves.toEqual({ claimed: 0, completed: 0, retrying: 0, exhausted: 0 });
    expect(repository.claim).toHaveBeenCalledWith(25, new Date('2026-09-12T01:00:00Z'), 8);
  });

  it('hands the promise to the Worker execution context', () => {
    const waitUntil = vi.fn();
    const repository = { claim: vi.fn().mockResolvedValue([]), complete: vi.fn(), fail: vi.fn() };
    handleScheduledDeletion({ scheduledTime: Date.parse('2026-09-12T01:00:00Z') }, { waitUntil }, { repository, effects });
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
