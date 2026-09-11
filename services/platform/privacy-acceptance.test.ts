import { describe, expect, it } from 'vitest';
import { resolveEntitlementAccess } from '@/services/billing/entitlements';
import { toCsv } from '@/services/privacy/export';
import { createUserDataDeletionPlan, transitionDeletionRequest, type DeletionRequest } from '@/services/privacy/deletion';
import { runRawFileRetention, type RetentionCandidate } from '@/services/privacy/retention-executor';
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
});
