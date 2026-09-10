import type { IsoDate } from '@/lib/domain/types';
import type { ValuationHistory } from '@/services/calculations/valuation';
import type { LedgerResult } from '@/services/ledger/fifo';

export type ReportSnapshotPayload = {
  activityCoveredThrough: IsoDate | null;
  valuationThrough: IsoDate | null;
  pricesThrough: IsoDate | null;
  totalValue: string | null;
  cash: string | null;
  timeWeightedReturn: string | null;
  netDeposits: string | null;
  dividendIncome: string | null;
  realizedGainLoss: string | null;
  realizedSales: LedgerResult['sales'];
  valueHistory: Array<{ date: IsoDate; value: string | null }>;
  holdings: ValuationHistory['valuations'][number]['holdings'];
  unavailableDates: Array<{ date: IsoDate; reason: string }>;
};

/** Builds a reproducible report payload from exact-decimal valuation output. */
export function buildReportSnapshotPayload(input: { history: ValuationHistory; activityCoveredThrough: IsoDate | null; pricesThrough: IsoDate | null; ledger?: Pick<LedgerResult, 'netDeposits' | 'dividendIncome' | 'realizedGainLoss'> & Partial<Pick<LedgerResult, 'sales'>> }): ReportSnapshotPayload {
  const latest = input.history.valuations.at(-1);
  return {
    activityCoveredThrough: input.activityCoveredThrough,
    valuationThrough: latest?.date ?? null,
    pricesThrough: input.pricesThrough,
    totalValue: latest?.totalValue ?? null,
    cash: latest ? (latest.totalValue === null ? null : latest.cash) : null,
    timeWeightedReturn: input.history.timeWeightedReturn,
    netDeposits: input.ledger?.netDeposits ?? null,
    dividendIncome: input.ledger?.dividendIncome ?? null,
    realizedGainLoss: input.ledger?.realizedGainLoss ?? null,
    realizedSales: input.ledger?.sales ?? [],
    valueHistory: input.history.valuations.map((valuation) => ({ date: valuation.date, value: valuation.totalValue })),
    holdings: latest?.holdings ?? [],
    unavailableDates: input.history.valuations.filter((valuation) => valuation.totalValue === null || valuation.return.return === null).map((valuation) => ({ date: valuation.date, reason: valuation.return.unavailableReason ?? 'missing_valuation' })),
  };
}
