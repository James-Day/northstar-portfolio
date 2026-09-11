export type OperationalSeverity = 'ok' | 'warning' | 'critical';
export type OperationalSignal = {
  component: 'imports' | 'market_data' | 'queues' | 'retention' | 'reports' | 'recovery';
  code: string;
  severity: OperationalSeverity;
  message: string;
  action: string;
};

export type OperationalStatus = {
  severity: OperationalSeverity;
  signals: OperationalSignal[];
  nextAction: string | null;
};

/** Turns durable worker counters into a secret-free operator status summary. */
export function summarizeOperationalStatus(input: {
  marketData?: { failedRuns?: number; quotaExhausted?: boolean; staleSymbols?: number; publicationPendingSymbols?: number; unresolvedInstrumentCount?: number; lastSuccessfulAt?: Date | null; maxSuccessAgeMs?: number };
  imports?: { failedImports?: number; pendingReviews?: number; unsupportedRows?: number };
  queues?: { failedJobs?: number; pendingJobs?: number };
  retention?: { exhaustedItems?: number; pendingItems?: number };
  reports?: { failedPublishes?: number; staleJobs?: number };
  recovery?: { lastBackupAt?: Date | null; maxBackupAgeMs?: number; restoreDrillDue?: boolean };
  now?: Date;
}): OperationalStatus {
  const signals: OperationalSignal[] = [];
  const add = (component: OperationalSignal['component'], severity: OperationalSeverity, code: string, message: string, action: string) => signals.push({ component, severity, code, message, action });
  const count = (value: number | undefined, label: string) => {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`${label} must be a non-negative integer.`);
    return value ?? 0;
  };
  const market = input.marketData;
  const now = input.now ?? new Date();
  const maxSuccessAgeMs = market?.maxSuccessAgeMs ?? 36 * 60 * 60 * 1000;
  if (!Number.isInteger(maxSuccessAgeMs) || maxSuccessAgeMs < 1) throw new Error('Market-data success freshness threshold must be a positive integer.');
  const imports = input.imports;
  if (count(imports?.failedImports, 'failedImports') > 0) add('imports', 'critical', 'imports.failed', `${imports?.failedImports} import(s) failed and need review.`, 'Open import history, inspect the failure, and retry or discard the staged file.');
  else if (count(imports?.pendingReviews, 'pendingReviews') > 0) add('imports', 'warning', 'imports.pending_review', `${imports?.pendingReviews} import(s) are waiting for user review.`, 'Open the import review queue and resolve warnings before committing.');
  else if (count(imports?.unsupportedRows, 'unsupportedRows') > 0) add('imports', 'warning', 'imports.unsupported_rows', `${imports?.unsupportedRows} imported row(s) are unsupported and may affect completeness.`, 'Review unsupported rows and provide opening history or a supported source.');
  if (market?.quotaExhausted) add('market_data', 'critical', 'market_data.quota_exhausted', 'Market-data quota is exhausted; new provider calls are paused.', 'Increase the provider allowance or wait for the monthly reset before retrying.');
  else if (count(market?.failedRuns, 'failedRuns') > 0) add('market_data', 'critical', 'market_data.refresh_failed', 'A market-data refresh failed after retries; affected valuations remain unavailable.', 'Inspect the provider run and retry after correcting the provider or persistence failure.');
  else if (count(market?.staleSymbols, 'staleSymbols') > 0) add('market_data', 'warning', 'market_data.stale_prices', `${market?.staleSymbols} market-data symbol(s) are stale.`, 'Inspect the stale symbols and retry the next eligible refresh; do not infer missing closes.');
  else if (count(market?.publicationPendingSymbols, 'publicationPendingSymbols') > 0) add('market_data', 'warning', 'market_data.publication_pending', `${market?.publicationPendingSymbols} market-data symbol(s) are awaiting end-of-day publication.`, 'Allow the publication worker to complete, then recheck freshness.');
  else if (count(market?.unresolvedInstrumentCount, 'unresolvedInstrumentCount') > 0) add('market_data', 'warning', 'market_data.unresolved_instrument', `${market?.unresolvedInstrumentCount} active instrument(s) have no current ticker alias.`, 'Resolve the instrument alias before requesting a price.');
  else if (market?.lastSuccessfulAt && now.getTime() - market.lastSuccessfulAt.getTime() > maxSuccessAgeMs) add('market_data', 'warning', 'market_data.refresh_overdue', 'No successful market-data refresh has completed within the expected freshness window.', 'Inspect the scheduled refresh and provider telemetry before publishing reports.');
  const queues = input.queues;
  if (count(queues?.failedJobs, 'failedJobs') > 0) add('queues', 'critical', 'queues.failed_jobs', `${queues?.failedJobs} queued job(s) require replay or investigation.`, 'Inspect the failed job and replay it only after confirming idempotency.');
  else if (count(queues?.pendingJobs, 'pendingJobs') > 100) add('queues', 'warning', 'queues.backlog', 'The queue backlog exceeds the operating threshold.', 'Inspect queue age and worker health before adding capacity or replaying work.');
  const retention = input.retention;
  if (count(retention?.exhaustedItems, 'exhaustedItems') > 0) add('retention', 'critical', 'retention.exhausted', `${retention?.exhaustedItems} private-file deletion(s) exhausted retries.`, 'Investigate the deletion error and resume the fenced cleanup worker.');
  else if (count(retention?.pendingItems, 'pendingItems') > 100) add('retention', 'warning', 'retention.backlog', 'Private-file retention backlog exceeds the operating threshold.', 'Inspect cleanup worker throughput and oldest pending object age.');
  const reports = input.reports;
  if (count(reports?.failedPublishes, 'failedPublishes') > 0) add('reports', 'critical', 'reports.publish_failed', `${reports?.failedPublishes} report publication(s) failed and need retry.`, 'Inspect the report job, correct its dependency, and replay the current revision.');
  else if (count(reports?.staleJobs, 'staleJobs') > 0) add('reports', 'warning', 'reports.stale_jobs', `${reports?.staleJobs} stale report job(s) were safely skipped.`, 'Allow the current report revision to run and confirm the dashboard freshness timestamp.');
  const recovery = input.recovery;
  const maxBackupAgeMs = recovery?.maxBackupAgeMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isInteger(maxBackupAgeMs) || maxBackupAgeMs < 1) throw new Error('Backup freshness threshold must be a positive integer.');
  if (recovery?.restoreDrillDue) add('recovery', 'critical', 'recovery.restore_drill_due', 'The backup/restore drill is due or has not been accepted.', 'Run the isolated restore drill and attach reviewed evidence before launch.');
  else if (recovery?.lastBackupAt && now.getTime() - recovery.lastBackupAt.getTime() > maxBackupAgeMs) add('recovery', 'critical', 'recovery.backup_overdue', 'No recent backup completed within the recovery-point target.', 'Verify the managed backup export and investigate the missing backup before accepting new risk.');
  const severity = signals.some((signal) => signal.severity === 'critical') ? 'critical' : signals.some((signal) => signal.severity === 'warning') ? 'warning' : 'ok';
  const priority: Record<OperationalSeverity, number> = { critical: 0, warning: 1, ok: 2 };
  const nextSignal = [...signals].sort((a, b) => priority[a.severity] - priority[b.severity])[0];
  return { severity, signals, nextAction: nextSignal?.action ?? null };
}
