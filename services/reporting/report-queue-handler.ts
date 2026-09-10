import type { QueueJob } from '@/services/queues/contracts';
import { valueLedgerHistory } from '@/services/calculations/valuation';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { publishReportSnapshot, type SnapshotPublisher } from '@/services/reporting/publish-snapshot';

type ReportJob = Extract<QueueJob, { kind: 'report.recompute' }>;

/**
 * The report worker only accepts a fully composed, account-scoped input.
 * Storage adapters are deliberately injected so this worker cannot quietly
 * invent a calendar, replay undone rows, or fetch prices from a provider.
 */
export type ReportRecomputeContext = {
  userId: string;
  accountId: string;
  inputs: PersistedReportInputs;
  priceRevisionId: string | null;
};

export type ReportRecomputeDependencies = {
  load(job: ReportJob): Promise<ReportRecomputeContext | undefined>;
  /** Returns false when a newer import, undo, or price correction superseded this worker. */
  isCurrent(job: ReportJob, context: ReportRecomputeContext): Promise<boolean>;
  publisher: SnapshotPublisher;
  calculate?: typeof valueLedgerHistory;
};

export type ReportRecomputeResult =
  | { status: 'published'; snapshotId: string }
  | { status: 'stale' | 'missing' };

/**
 * Calculates and publishes an account report from one immutable dependency
 * revision. Stale work is acknowledged by the queue caller without publishing;
 * transient loader/calculation/publisher errors are allowed to escape so the
 * queue dispatcher can retry them.
 *
 * Publication itself is idempotent at the repository boundary: the snapshot
 * repository uses account/report/as-of/import/price revisions as its unique
 * publication key. Retrying this function therefore cannot create a second
 * snapshot for the same dependency set.
 */
export async function recomputeReport(job: ReportJob, dependencies: ReportRecomputeDependencies): Promise<ReportRecomputeResult> {
  const context = await dependencies.load(job);
  if (!context) return { status: 'missing' };
  if (context.userId !== job.requestedBy) throw new Error('Report job requester does not own the loaded account.');
  if (!(await dependencies.isCurrent(job, context))) return { status: 'stale' };

  const calculate = dependencies.calculate ?? valueLedgerHistory;
  const history = calculate(context.inputs.valuation);

  // Re-check after the potentially expensive valuation to avoid publishing a
  // result based on a newer revision that arrived while the worker ran.
  if (!(await dependencies.isCurrent(job, context))) return { status: 'stale' };

  const snapshotId = await publishReportSnapshot({
    publisher: dependencies.publisher,
    userId: context.userId,
    accountId: context.accountId,
    reportType: 'account_daily',
    importStateRevision: context.inputs.importStateRevision,
    priceRevisionId: context.priceRevisionId,
    history,
    activityCoveredThrough: context.inputs.activityCoveredThrough,
    pricesThrough: context.inputs.pricesThrough,
    ledger: context.inputs.ledger,
  });
  return { status: 'published', snapshotId };
}

/** Adapts the result-returning worker to the queue handler contract. */
export function createReportRecomputeHandler(dependencies: ReportRecomputeDependencies) {
  return async (job: ReportJob): Promise<void> => {
    await recomputeReport(job, dependencies);
  };
}
