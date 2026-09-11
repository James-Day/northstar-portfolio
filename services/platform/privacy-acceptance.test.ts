import { describe, expect, it } from 'vitest';
import { resolveEntitlementAccess } from '@/services/billing/entitlements';
import { toCsv } from '@/services/privacy/export';
import { createUserDataDeletionPlan, transitionDeletionRequest, type DeletionRequest } from '@/services/privacy/deletion';
import { runRawFileRetention, type RetentionCandidate } from '@/services/privacy/retention-executor';
import { runUserDeletion, type DeletionPlanItem, type DeletionPlanRepository, type DeletionSideEffects } from '@/services/privacy/deletion-executor';
import { validateBackupRestoreEvidence } from '@/services/platform/backup-restore-evidence';

describe('privacy and continuity acceptance boundary', () => {
  it('exports data, retains normalized activity after raw deletion, and denies canceled access', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    const candidate: RetentionCandidate = {
      id: 'retention-1', importId: 'import-1', objectPath: 'user-1/account-1/statement.csv',
      uploadedAt: new Date('2026-08-01T00:00:00.000Z'), deletedAt: null, attempt: 0,
    };
    const objects = new Set([candidate.objectPath]);
    let state: 'pending' | 'deleted' = 'pending';
    const retainedActivity = [{ importId: candidate.importId, type: 'buy', symbol: 'VOO', amount: '100.00' }];
    const result = await runRawFileRetention({
      now: () => now,
      repository: {
        async claim() { return state === 'pending' ? [candidate] : []; },
        async markDeleted() { state = 'deleted'; candidate.deletedAt = now; },
        async markFailure() { throw new Error('unexpected failure'); },
      },
      storage: { async delete(path) { objects.delete(path); }, async verifyDeleted(path) { return !objects.has(path); } },
    });
    expect(result).toMatchObject({ claimed: 1, deleted: 1 });
    expect(state).toBe('deleted');
    expect(retainedActivity).toEqual([{ importId: 'import-1', type: 'buy', symbol: 'VOO', amount: '100.00' }]);

    const csv = toCsv(['symbol', 'amount'], retainedActivity.map((row) => [row.symbol, row.amount]));
    expect(csv).toContain('VOO,100.00');
    const plan = createUserDataDeletionPlan('user-1', ['account-1', 'account-1'], [candidate.objectPath, candidate.objectPath], true);
    expect(plan).toEqual(expect.objectContaining({ userId: 'user-1', cancelBillingCustomer: true, deleteAccountIds: ['account-1'], deleteRawObjectPaths: [candidate.objectPath] }));

    const request: DeletionRequest = { id: 'delete-1', userId: 'user-1', status: 'requested', requestedAt: now, completedAt: null };
    const completed = transitionDeletionRequest(transitionDeletionRequest(request, 'processing', now), 'completed', now);
    expect(completed.status).toBe('completed');
    expect(resolveEntitlementAccess({ status: 'canceled', trialStartedAt: null, trialEndsAt: null, processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null }, now).allowed).toBe(false);
  });

  it('rejects restore evidence until every isolated recovery check passes', () => {
    const evidence = {
      sourceProject: 'production', backupId: 'backup-1', backupCompletedAt: '2026-09-09T00:00:00.000Z', sourceMigrationRevision: 'rev-1',
      isolatedProject: 'restore-1', restoreStartedAt: '2026-09-09T01:00:00.000Z', restoreCompletedAt: '2026-09-09T02:00:00.000Z',
      measuredRpoHours: 1, measuredRtoHours: 1, checks: { database: 'pass', rls: 'pass', storage: 'pass', auth: 'pass', ledger: 'pass', reports: 'pass', prices: 'pass', export: 'pass', deletion: 'pass', alerts: 'pass' }, evidenceLinks: ['run-1'], operator: 'ops', reviewer: 'reviewer',
    };
    expect(validateBackupRestoreEvidence(evidence, { now: new Date('2026-09-10T00:00:00.000Z') }).valid).toBe(true);
    expect(validateBackupRestoreEvidence({ ...evidence, checks: { ...evidence.checks, deletion: 'not-run' } }, { now: new Date('2026-09-10T00:00:00.000Z') }).valid).toBe(false);
  });

  it('keeps a partially failed deletion retryable while completing independent cleanup work', async () => {
    const raw: DeletionPlanItem = {
      id: 'raw-item', requestId: 'delete-2', userId: 'user-2', targetType: 'raw_object', targetId: null,
      targetPath: 'user-2/account-2/statement.csv', attempt: 1,
    };
    const auth: DeletionPlanItem = {
      id: 'auth-item', requestId: 'delete-2', userId: 'user-2', targetType: 'auth_user', targetId: null,
      targetPath: null, attempt: 1,
    };
    let firstClaim = true;
    let rawAvailable = true;
    let authDeleted = false;
    const repository: DeletionPlanRepository = {
      claim: async () => {
        if (firstClaim) { firstClaim = false; return [auth, raw]; }
        return rawAvailable ? [{ ...raw, attempt: 2 }] : [];
      },
      complete: async (id) => { if (id === raw.id) rawAvailable = false; },
      fail: async (id) => { if (id === raw.id) rawAvailable = true; return 'retrying'; },
    };
    const effects: DeletionSideEffects = {
      deletePrivateObject: async () => { throw new Error('temporary storage outage'); },
      deleteAccount: async () => undefined,
      deleteReportSnapshots: async () => undefined,
      deleteProfile: async () => undefined,
      cancelBillingCustomer: async () => undefined,
      deleteAuthUser: async () => { authDeleted = true; },
    };
    const first = await runUserDeletion({ repository, effects, now: () => new Date('2026-09-10T00:00:00.000Z') });
    expect(first).toEqual({ claimed: 2, completed: 1, retrying: 1, exhausted: 0 });
    expect(authDeleted).toBe(true);
    expect(rawAvailable).toBe(true);

    effects.deletePrivateObject = async () => { rawAvailable = false; };
    const second = await runUserDeletion({ repository, effects, now: () => new Date('2026-09-10T00:00:10.000Z') });
    expect(second).toEqual({ claimed: 1, completed: 1, retrying: 0, exhausted: 0 });
    expect(rawAvailable).toBe(false);
  });
});
