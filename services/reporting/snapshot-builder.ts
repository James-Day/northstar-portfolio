import type { IsoDate } from '@/lib/domain/types';
import type { ValuationHistory } from '@/services/calculations/valuation';

export type ReportSnapshotPayload = {
  activityCoveredThrough: IsoDate | null;
  valuationThrough: IsoDate | null;
  pricesThrough: IsoDate | null;
  totalValue: string | null;
  cash: string | null;
  timeWeightedReturn: string | null;
  holdings: ValuationHistory['valuations'][number]['holdings'];
  unavailableDates: Array<{ date: IsoDate; reason: string }>;
};

/** Builds a reproducible report payload from exact-decimal valuation output. */
export function buildReportSnapshotPayload(input: { history: ValuationHistory; activityCoveredThrough: IsoDate | null; pricesThrough: IsoDate | null }): ReportSnapshotPayload {
  const latest = input.history.valuations.at(-1);
  return {
    activityCoveredThrough: input.activityCoveredThrough,
    valuationThrough: latest?.date ?? null,
    pricesThrough: input.pricesThrough,
    totalValue: latest?.totalValue ?? null,
    cash: latest ? (latest.totalValue === null ? null : latest.cash) : null,
    timeWeightedReturn: input.history.timeWeightedReturn,
    holdings: latest?.holdings ?? [],
    unavailableDates: input.history.valuations.filter((valuation) => valuation.totalValue === null || valuation.return.return === null).map((valuation) => ({ date: valuation.date, reason: valuation.return.unavailableReason ?? 'missing_valuation' })),
  };
}
