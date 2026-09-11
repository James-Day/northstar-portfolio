export type EvidenceStatus = 'pass' | 'fail' | 'not-run';

export type LaunchEvidenceCheck = {
  id: string;
  status: EvidenceStatus;
  message: string;
};

export type LaunchEvidenceInput = {
  baseline: {
    typecheck: EvidenceStatus;
    tests: EvidenceStatus;
    build: EvidenceStatus;
    browserSecretScan: EvidenceStatus;
  };
  preflight: {
    environment: 'staging' | 'production';
    passed: boolean;
    checks: Array<{ id: string; status: 'pass' | 'fail' | 'warn'; message?: string }>;
  };
  backupRestore: {
    valid: boolean;
    errors?: string[];
  };
  provenance: {
    rightsReview: 'approved' | 'blocked';
    commercialPlan: string;
  };
  hosted: Record<string, EvidenceStatus>;
  deployment: {
    environment: 'staging' | 'production';
    workerRevision: string;
    migrationRevision: string;
    deployedAt: string;
  };
  rollback: {
    runbookPresent: boolean;
    lastKnownGoodWorkerRevision: string;
    migrationRecovery: string;
    queueRecovery: string;
    owner: string;
    verifiedAt: string;
  };
};

export type LaunchEvidenceResult = {
  ready: boolean;
  checks: LaunchEvidenceCheck[];
  blockers: string[];
  summary: {
    passed: number;
    failed: number;
    notRun: number;
  };
};

const HOSTED_REQUIREMENTS = ['supabase', 'auth', 'storage', 'queues', 'cron', 'stripe', 'rls', 'imports', 'deletion', 'restore', 'browser'] as const;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(checks: LaunchEvidenceCheck[], id: string, status: EvidenceStatus, message: string) {
  checks.push({ id, status, message });
}

/**
 * Produces the final launch evidence record from separately verified inputs.
 * Every hosted requirement is fail-closed: local code or documentation cannot
 * substitute for a passing staging/production execution record.
 */
export function aggregateLaunchEvidence(input: LaunchEvidenceInput): LaunchEvidenceResult {
  const checks: LaunchEvidenceCheck[] = [];
  const blockers: string[] = [];
  const baseline = input?.baseline;
  for (const name of ['typecheck', 'tests', 'build', 'browserSecretScan'] as const) {
    const status = baseline?.[name];
    add(checks, `baseline.${name}`, status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'not-run', status === 'pass' ? `${name} passed.` : `${name} has not passed.`);
  }

  const preflight = input?.preflight;
  const preflightChecks = Array.isArray(preflight?.checks) ? preflight.checks : [];
  const preflightPassed = preflight?.passed === true && preflightChecks.length > 0 && preflightChecks.every((check) => check.status === 'pass');
  add(checks, 'configuration.preflight', preflightPassed ? 'pass' : 'fail', preflightPassed ? 'Launch preflight passed without warnings.' : 'Launch preflight is incomplete, failed, or contains warnings.');

  add(checks, 'recovery.backup-restore', input?.backupRestore?.valid === true ? 'pass' : 'fail', input?.backupRestore?.valid === true ? 'Backup/restore evidence passed validation.' : 'A validated backup/restore drill is required.');

  const provenance = input?.provenance;
  const rightsApproved = provenance?.rightsReview === 'approved' && nonEmpty(provenance.commercialPlan);
  add(checks, 'market-data.rights', rightsApproved ? 'pass' : 'fail', rightsApproved ? 'Market-data rights and commercial plan are approved.' : 'Market-data rights review and commercial plan approval are required.');

  for (const name of HOSTED_REQUIREMENTS) {
    const status = input?.hosted?.[name];
    add(checks, `hosted.${name}`, status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'not-run', status === 'pass' ? `${name} verification passed.` : `${name} hosted verification is not complete.`);
  }

  const deployment = input?.deployment;
  const deploymentValid = deployment?.environment === preflight?.environment && nonEmpty(deployment?.workerRevision) && nonEmpty(deployment?.migrationRevision) && UTC_TIMESTAMP.test(deployment?.deployedAt ?? '');
  add(checks, 'deployment.revision', deploymentValid ? 'pass' : 'fail', deploymentValid ? 'Deployed environment, Worker revision, migration revision, and timestamp are recorded.' : 'A deployed environment and immutable Worker/migration revisions are required.');

  const rollback = input?.rollback;
  const rollbackValid = rollback?.runbookPresent === true && nonEmpty(rollback.lastKnownGoodWorkerRevision) && nonEmpty(rollback.migrationRecovery) && nonEmpty(rollback.queueRecovery) && nonEmpty(rollback.owner) && UTC_TIMESTAMP.test(rollback.verifiedAt ?? '');
  add(checks, 'recovery.rollback', rollbackValid ? 'pass' : 'fail', rollbackValid ? 'Rollback owner, revision, migration, queue, and verification evidence are recorded.' : 'Rollback procedure and last-known-good revision evidence are required.');

  for (const check of checks) if (check.status !== 'pass') blockers.push(check.id);
  const summary = { passed: checks.filter((check) => check.status === 'pass').length, failed: checks.filter((check) => check.status === 'fail').length, notRun: checks.filter((check) => check.status === 'not-run').length };
  return { ready: blockers.length === 0, checks, blockers, summary };
}
