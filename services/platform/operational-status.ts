export type OperationalSeverity = 'ok' | 'warning' | 'critical';
export type OperationalSignal = {
  component: 'market_data' | 'queues' | 'retention' | 'reports';
  severity: OperationalSeverity;
  message: string;
};

export type OperationalStatus = {
  severity: OperationalSeverity;
  signals: OperationalSignal[];
};

/** Turns durable worker counters into a secret-free operator status summary. */
export function summarizeOperationalStatus(input: {
  marketData?: { failedRuns?: number; quotaExhausted?: boolean; staleSymbols?: number };
  queues?: { failedJobs?: number; pendingJobs?: number };
  retention?: { exhaustedItems?: number; pendingItems?: number };
  reports?: { failedPublishes?: number; staleJobs?: number };
}): OperationalStatus {
  const signals: OperationalSignal[] = [];
  const add = (component: OperationalSignal['component'], severity: OperationalSeverity, message: string) => signals.push({ component, severity, message });
  const market = input.marketData;
  if (market?.quotaExhausted) add('market_data', 'critical', 'Market-data quota is exhausted; new provider calls are paused.');
  else if ((market?.failedRuns ?? 0) > 0) add('market_data', 'critical', 'A market-data refresh failed after retries; affected valuations remain unavailable.');
  else if ((market?.staleSymbols ?? 0) > 0) add('market_data', 'warning', `${market?.staleSymbols} market-data symbol(s) are stale.`);
  const queues = input.queues;
  if ((queues?.failedJobs ?? 0) > 0) add('queues', 'critical', `${queues?.failedJobs} queued job(s) require replay or investigation.`);
  else if ((queues?.pendingJobs ?? 0) > 100) add('queues', 'warning', 'The queue backlog exceeds the operating threshold.');
  const retention = input.retention;
  if ((retention?.exhaustedItems ?? 0) > 0) add('retention', 'critical', `${retention?.exhaustedItems} private-file deletion(s) exhausted retries.`);
  else if ((retention?.pendingItems ?? 0) > 100) add('retention', 'warning', 'Private-file retention backlog exceeds the operating threshold.');
  const reports = input.reports;
  if ((reports?.failedPublishes ?? 0) > 0) add('reports', 'critical', `${reports?.failedPublishes} report publication(s) failed and need retry.`);
  else if ((reports?.staleJobs ?? 0) > 0) add('reports', 'warning', `${reports?.staleJobs} stale report job(s) were safely skipped.`);
  const severity = signals.some((signal) => signal.severity === 'critical') ? 'critical' : signals.some((signal) => signal.severity === 'warning') ? 'warning' : 'ok';
  return { severity, signals };
}
