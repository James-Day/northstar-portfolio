import { describe, expect, it } from 'vitest';
import { aggregateLaunchEvidence, type LaunchEvidenceInput } from './launch-evidence';

const validEvidence = (): LaunchEvidenceInput => ({
  baseline: { typecheck: 'pass', tests: 'pass', build: 'pass', browserSecretScan: 'pass' },
  preflight: { environment: 'staging', passed: true, checks: [{ id: 'env', status: 'pass' }] },
  backupRestore: { valid: true },
  provenance: { rightsReview: 'approved', commercialPlan: 'commercial-basic' },
  hosted: { supabase: 'pass', auth: 'pass', storage: 'pass', queues: 'pass', cron: 'pass', stripe: 'pass', rls: 'pass', imports: 'pass', deletion: 'pass', restore: 'pass', browser: 'pass' },
  deployment: { environment: 'staging', workerRevision: 'worker-123', migrationRevision: 'migration-456', deployedAt: '2026-09-13T12:00:00.000Z' },
  rollback: { runbookPresent: true, lastKnownGoodWorkerRevision: 'worker-122', migrationRecovery: 'forward-migration-7', queueRecovery: 'pause-and-replay', owner: 'ops@example.test', verifiedAt: '2026-09-13T12:30:00.000Z' },
});

describe('launch evidence aggregator', () => {
  it('accepts only a complete, warning-free launch record', () => {
    const result = aggregateLaunchEvidence(validEvidence());
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.summary.failed).toBe(0);
  });

  it('fails closed when hosted evidence, rights approval, or rollback data is missing', () => {
    const evidence = validEvidence();
    evidence.hosted.storage = 'not-run';
    evidence.provenance.rightsReview = 'blocked';
    evidence.rollback.lastKnownGoodWorkerRevision = '';
    const result = aggregateLaunchEvidence(evidence);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['hosted.storage', 'market-data.rights', 'recovery.rollback']));
    expect(result.summary.notRun).toBe(1);
  });

  it('rejects a preflight with warnings and mismatched deployment environment', () => {
    const evidence = validEvidence();
    evidence.preflight.checks.push({ id: 'warning', status: 'warn' });
    evidence.deployment.environment = 'production';
    const result = aggregateLaunchEvidence(evidence);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['configuration.preflight', 'deployment.revision']));
  });
});
