import { isoDate, type IsoDate } from '@/lib/domain/types';
import type { PersistedLedgerReplay } from '@/services/ledger/persisted-replay';
import type { QueueJob } from '@/services/queues/contracts';

type ReportJob = Extract<QueueJob, { kind: 'report.recompute' }>;

/** Explicit scheduler policy for report date ranges. The end date must come
 * from the scheduler/price publication state; this function never invents a
 * close or bridges a missing market-data day. */
export function resolveReportRange(input: {
  job: ReportJob;
  replay: PersistedLedgerReplay;
  through: IsoDate;
  maxDays?: number;
}): { from: IsoDate; through: IsoDate } {
  const dates = [
    ...input.replay.events.map((event) => event.date),
    ...input.replay.openingLots.map((lot) => lot.acquiredOn).filter((date): date is IsoDate => Boolean(date)),
  ].sort();
  const from = dates[0] ?? input.through;
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${input.through}T00:00:00.000Z`).getTime();
  const maxDays = input.maxDays ?? 5 * 366;
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new Error('Report range limit must be positive.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Report range is invalid.');
  if ((end - start) / 86_400_000 > maxDays) throw new Error('Report range exceeds the configured lookback limit.');
  return { from: isoDate(from), through: isoDate(input.through) };
}
