export type DrillCheckStatus = 'pass' | 'fail' | 'not-run';

export type BackupRestoreEvidence = {
  sourceProject: string;
  backupId: string;
  backupCompletedAt: string;
  sourceMigrationRevision: string;
  isolatedProject: string;
  restoreStartedAt: string;
  restoreCompletedAt: string;
  measuredRpoHours: number;
  measuredRtoHours: number;
  checks: {
    database: DrillCheckStatus;
    rls: DrillCheckStatus;
    storage: DrillCheckStatus;
    auth: DrillCheckStatus;
    ledger: DrillCheckStatus;
    reports: DrillCheckStatus;
    prices: DrillCheckStatus;
    export: DrillCheckStatus;
    deletion: DrillCheckStatus;
    alerts: DrillCheckStatus;
  };
  evidenceLinks: string[];
  operator: string;
  reviewer: string;
};

export type BackupRestoreValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const REQUIRED_CHECKS = ['database', 'rls', 'storage', 'auth', 'ledger', 'reports', 'prices', 'export', 'deletion', 'alerts'] as const;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function requiredText(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} is required.`);
    return false;
  }
  return true;
}

function timestamp(value: unknown, field: string, errors: string[]): Date | null {
  if (!requiredText(value, field, errors) || !ISO_UTC.test(value)) {
    if (typeof value === 'string' && value.trim() !== '' && !ISO_UTC.test(value)) errors.push(`${field} must be an ISO-8601 UTC timestamp ending in Z.`);
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) errors.push(`${field} is not a valid timestamp.`);
  return parsed;
}

/**
 * Validates operator-entered restore evidence. This checks the evidence record
 * only; it cannot establish that a hosted backup or restore really happened.
 */
export function validateBackupRestoreEvidence(input: unknown, options: { now?: Date; maxRpoHours?: number; maxRtoHours?: number } = {}): BackupRestoreValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['Evidence must be a JSON object.'], warnings };
  const record = input as Record<string, unknown>;
  for (const field of ['sourceProject', 'backupId', 'sourceMigrationRevision', 'isolatedProject', 'operator', 'reviewer']) requiredText(record[field], field, errors);
  const backup = timestamp(record.backupCompletedAt, 'backupCompletedAt', errors);
  const started = timestamp(record.restoreStartedAt, 'restoreStartedAt', errors);
  const completed = timestamp(record.restoreCompletedAt, 'restoreCompletedAt', errors);
  const now = options.now ?? new Date();
  if (backup && started && started < backup) errors.push('restoreStartedAt must be at or after backupCompletedAt.');
  if (started && completed && completed < started) errors.push('restoreCompletedAt must be at or after restoreStartedAt.');
  if (completed && completed > now) errors.push('restoreCompletedAt cannot be in the future.');

  const maxRpo = options.maxRpoHours ?? 24;
  const maxRto = options.maxRtoHours ?? 4;
  for (const [field, maximum] of [['measuredRpoHours', maxRpo], ['measuredRtoHours', maxRto]] as const) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`${field} must be a finite non-negative number.`);
    else if (value > maximum) errors.push(`${field} exceeds the ${maximum}-hour recovery target.`);
  }
  const checks = record.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) errors.push('checks must include every recovery invariant.');
  else for (const name of REQUIRED_CHECKS) {
    const status = (checks as Record<string, unknown>)[name];
    if (status !== 'pass') errors.push(`checks.${name} must be pass before the drill can be accepted.`);
  }
  const links = record.evidenceLinks;
  if (!Array.isArray(links) || links.length === 0 || links.some((link) => typeof link !== 'string' || link.trim() === '')) errors.push('evidenceLinks must contain at least one non-empty link or record reference.');
  if (Array.isArray(links) && links.some((link) => typeof link === 'string' && /password|secret|token|service_role/i.test(link))) errors.push('evidenceLinks must not contain credentials or secret-bearing URLs.');
  if (backup && started && started.getTime() - backup.getTime() > maxRpo * 60 * 60 * 1000) warnings.push('The restore started more than the target RPO after the backup completed.');
  return { valid: errors.length === 0, errors, warnings };
}
