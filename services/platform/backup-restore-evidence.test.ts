import { describe, expect, it } from 'vitest';
import { validateBackupRestoreEvidence, type BackupRestoreEvidence } from './backup-restore-evidence';

const validEvidence = (): BackupRestoreEvidence => ({
  sourceProject: 'staging-source', backupId: 'backup-2026-09-12', backupCompletedAt: '2026-09-12T01:00:00.000Z',
  sourceMigrationRevision: '20260912090000', isolatedProject: 'restore-drill-2026-09-12', restoreStartedAt: '2026-09-12T01:30:00.000Z', restoreCompletedAt: '2026-09-12T02:45:00.000Z', measuredRpoHours: 1, measuredRtoHours: 1.25,
  checks: { database: 'pass', rls: 'pass', storage: 'pass', auth: 'pass', ledger: 'pass', reports: 'pass', prices: 'pass', export: 'pass', deletion: 'pass', alerts: 'pass' },
  evidenceLinks: ['deployment-record:DR-12'], operator: 'operator@example.test', reviewer: 'reviewer@example.test',
});

describe('backup restore evidence validator', () => {
  it('accepts a complete evidence record within the recovery targets', () => {
    expect(validateBackupRestoreEvidence(validEvidence(), { now: new Date('2026-09-12T03:00:00.000Z') })).toEqual({ valid: true, errors: [], warnings: [] });
  });
  it('requires all reconciliation and alert checks to pass', () => {
    const evidence = validEvidence();
    evidence.checks.alerts = 'not-run';
    evidence.checks.prices = 'fail';
    const result = validateBackupRestoreEvidence(evidence, { now: new Date('2026-09-12T03:00:00.000Z') });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['checks.alerts must be pass before the drill can be accepted.', 'checks.prices must be pass before the drill can be accepted.']));
  });
  it('rejects bad chronology, target breaches, future completion, and secret-bearing links', () => {
    const evidence = validEvidence();
    evidence.restoreStartedAt = '2026-09-12T00:30:00.000Z';
    evidence.restoreCompletedAt = '2026-09-13T00:00:00.000Z';
    evidence.measuredRpoHours = 25;
    evidence.measuredRtoHours = 5;
    evidence.evidenceLinks = ['https://example.test/run?token=should-not-be-here'];
    const result = validateBackupRestoreEvidence(evidence, { now: new Date('2026-09-12T03:00:00.000Z') });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['restoreStartedAt must be at or after backupCompletedAt.', 'restoreCompletedAt cannot be in the future.', 'measuredRpoHours exceeds the 24-hour recovery target.', 'measuredRtoHours exceeds the 4-hour recovery target.', 'evidenceLinks must not contain credentials or secret-bearing URLs.']));
  });
  it('does not accept malformed input as evidence', () => {
    expect(validateBackupRestoreEvidence(null).valid).toBe(false);
  });
});
