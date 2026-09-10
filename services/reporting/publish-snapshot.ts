import type { IsoDate } from '@/lib/domain/types';
import type { LedgerResult } from '@/services/ledger/fifo';
import { buildReportSnapshotPayload } from '@/services/reporting/snapshot-builder';
import type { ValuationHistory } from '@/services/calculations/valuation';
import type { PriceDependency } from '@/services/market-data/price-corrections';

export type SnapshotPublisher = {
  publish(input: { userId: string; accountId?: string | null; reportType: 'account_daily' | 'consolidated_daily' | 'dashboard'; asOfDate: IsoDate; importStateRevision: string; priceRevisionId?: string | null; payload: Record<string, unknown> }): Promise<string>;
};

/** Builds and publishes one reproducible snapshot with its activity/price dependencies. */
export async function publishReportSnapshot(input: {
  publisher: SnapshotPublisher;
  userId: string;
  accountId?: string | null;
  reportType: 'account_daily' | 'consolidated_daily' | 'dashboard';
  importStateRevision: string;
  priceRevisionId?: string | null;
  history: ValuationHistory;
  activityCoveredThrough: IsoDate | null;
  pricesThrough: IsoDate | null;
  priceDependencies?: PriceDependency[];
  ledger?: Pick<LedgerResult, 'netDeposits' | 'dividendIncome' | 'realizedGainLoss'>;
}): Promise<string> {
  const payload = buildReportSnapshotPayload(input);
  if (!payload.valuationThrough) throw new Error('Cannot publish a report without an as-of valuation date.');
  return input.publisher.publish({
    userId: input.userId,
    accountId: input.accountId,
    reportType: input.reportType,
    asOfDate: payload.valuationThrough,
    importStateRevision: input.importStateRevision,
    priceRevisionId: input.priceRevisionId,
    payload,
  });
}
