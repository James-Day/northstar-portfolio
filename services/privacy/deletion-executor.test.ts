import { describe, expect, it, vi } from 'vitest';
import { runUserDeletion, type DeletionPlanItem, type DeletionPlanRepository, type DeletionSideEffects } from './deletion-executor';

const item = (targetType: DeletionPlanItem['targetType'], id: string): DeletionPlanItem => ({ id, requestId: 'req', userId: 'user', targetType, targetId: targetType === 'account' ? `account-${id}` : null, targetPath: targetType === 'raw_object' ? `user/${id}.csv` : null, attempt: 1 });

function fixture(items: DeletionPlanItem[]) {
  const repository: DeletionPlanRepository = { claim: vi.fn().mockResolvedValue(items), complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue('retrying') };
  const effects: DeletionSideEffects = {
    deletePrivateObject: vi.fn().mockResolvedValue(undefined), deleteAccount: vi.fn().mockResolvedValue(undefined), deleteReportSnapshots: vi.fn().mockResolvedValue(undefined), deleteProfile: vi.fn().mockResolvedValue(undefined), cancelBillingCustomer: vi.fn().mockResolvedValue(undefined), deleteAuthUser: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, effects };
}

describe('user deletion executor', () => {
  it('runs dependencies in a stable order and completes each item only after its side effect', async () => {
    const f = fixture([item('auth_user', 'auth'), item('profile', 'profile'), item('account', 'account'), item('raw_object', 'file'), item('report_snapshots', 'reports'), item('billing_customer', 'billing')]);
    const order: string[] = [];
    for (const [name, fn] of Object.entries(f.effects)) (fn as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push(name); });
    const result = await runUserDeletion({ repository: f.repository, effects: f.effects, now: () => new Date('2026-01-01T00:00:00Z') });
    expect(result).toEqual({ claimed: 6, completed: 6, retrying: 0, exhausted: 0 });
    expect(order).toEqual(['deletePrivateObject', 'deleteAccount', 'deleteReportSnapshots', 'cancelBillingCustomer', 'deleteProfile', 'deleteAuthUser']);
    expect(f.repository.complete).toHaveBeenCalledTimes(6);
    expect(f.repository.complete).toHaveBeenCalledWith('file', expect.any(Date), 1);
  });

  it('records a bounded retry and continues independent plan items after a transient failure', async () => {
    const f = fixture([item('raw_object', 'bad'), item('report_snapshots', 'reports')]);
    (f.effects.deletePrivateObject as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage unavailable'));
    const result = await runUserDeletion({ repository: f.repository, effects: f.effects, maxAttempts: 8, now: () => new Date('2026-01-01T00:00:00Z') });
    expect(result).toEqual({ claimed: 2, completed: 1, retrying: 1, exhausted: 0 });
    expect(f.repository.fail).toHaveBeenCalledWith('bad', expect.objectContaining({ error: 'storage unavailable', attempt: 1, retryAt: new Date('2026-01-01T00:00:05Z') }));
    expect(f.repository.complete).toHaveBeenCalledWith('reports', expect.any(Date), 1);
  });

  it('does not perform a malformed side effect and preserves the failure boundary', async () => {
    const malformed = { ...item('raw_object', 'missing'), targetPath: null };
    const f = fixture([malformed]);
    const result = await runUserDeletion({ repository: f.repository, effects: f.effects });
    expect(result).toMatchObject({ claimed: 1, completed: 0, retrying: 1 });
    expect(f.effects.deletePrivateObject).not.toHaveBeenCalled();
    expect(f.repository.fail).toHaveBeenCalledWith('missing', expect.objectContaining({ error: 'Deletion raw-object item has no object path.' }));
  });

  it('refuses a raw-object path outside the requesting user prefix', async () => {
    const f = fixture([{ ...item('raw_object', 'outside'), targetPath: 'other-user/statement.csv' }]);
    const result = await runUserDeletion({ repository: f.repository, effects: f.effects });
    expect(result).toMatchObject({ claimed: 1, completed: 0, retrying: 1 });
    expect(f.effects.deletePrivateObject).not.toHaveBeenCalled();
    expect(f.repository.fail).toHaveBeenCalledWith('outside', expect.objectContaining({ error: 'Deletion raw-object item has an invalid user-owned path.' }));
  });

  it('redacts credential-shaped deletion failures before durable audit persistence', async () => {
    const f = fixture([item('report_snapshots', 'reports')]);
    (f.effects.deleteReportSnapshots as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('upstream https://storage.example/delete?token=secret token=abc123 password=hunter2'),
    );

    const result = await runUserDeletion({ repository: f.repository, effects: f.effects, now: () => new Date('2026-01-01T00:00:00Z') });

    expect(result).toEqual({ claimed: 1, completed: 0, retrying: 1, exhausted: 0 });
    expect(f.repository.fail).toHaveBeenCalledWith('reports', expect.objectContaining({
      error: 'upstream [redacted-url] token=[redacted] password=[redacted]',
    }));
  });
});
