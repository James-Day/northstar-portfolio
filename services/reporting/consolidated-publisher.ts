import type { IsoDate } from '@/lib/domain/types';
import type { TransferLink, UnresolvedTransfer } from '@/services/ledger/transfers';
import { calculateConsolidatedReport, type ConsolidatedAccountInput } from '@/services/reporting/consolidated';
import { publishReportSnapshot, type SnapshotPublisher } from '@/services/reporting/publish-snapshot';

/** Publishes one deterministic all-account snapshot from already persisted inputs. */
export async function publishConsolidatedReportSnapshot(input: {
  publisher: SnapshotPublisher;
  userId: string;
  accounts: ConsolidatedAccountInput[];
  links?: TransferLink[];
  unresolvedTransfers?: UnresolvedTransfer[];
  priceRevisionId?: string | null;
  dates?: Parameters<typeof calculateConsolidatedReport>[0]['dates'];
}): Promise<{ snapshotId: string; importStateRevision: string; asOfDate: IsoDate }> {
  const result = calculateConsolidatedReport({
    accounts: input.accounts,
    links: input.links,
    unresolvedTransfers: input.unresolvedTransfers,
    dates: input.dates,
  });
  const snapshotId = await publishReportSnapshot({
    publisher: input.publisher,
    userId: input.userId,
    accountId: null,
    reportType: 'consolidated_daily',
    importStateRevision: result.inputs.importStateRevision,
    priceRevisionId: input.priceRevisionId,
    history: result.history,
    activityCoveredThrough: result.inputs.activityCoveredThrough,
    pricesThrough: result.inputs.pricesThrough,
    ledger: result.inputs.ledger,
  });
  const asOfDate = result.history.valuations.at(-1)?.date;
  if (!asOfDate) throw new Error('Consolidated report produced no valuation date.');
  return { snapshotId, importStateRevision: result.inputs.importStateRevision, asOfDate };
}
