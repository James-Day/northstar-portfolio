import type { IsoDate } from '@/lib/domain/types';
import type { ValuationHistory } from '@/services/calculations/valuation';
import type { LedgerResult } from '@/services/ledger/fifo';
import type { PriceDependency } from '@/services/market-data/price-corrections';

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
  priceDependencies: PriceDependency[];
  methodology: ReportMethodology;
};

/**
 * User-facing definitions for the analytical figures in a report. Keep these
 * beside the payload so exports, API consumers, and the dashboard share the
 * same disclosures instead of each inventing its own wording.
 */
export type ReportMethodology = {
  returnMethod: 'daily_modified_dietz_chained';
  externalFlowTiming: 'midpoint_approximation';
  annualized: false;
  gapHandling: 'unavailable';
  investmentGainDefinition: 'ending_value_minus_beginning_value_minus_external_flows_minus_excluded_incentives';
  realizedGainLossDefinition: 'fifo_analytical_lot_matching';
  taxReporting: false;
  disclosure: string;
};

export const reportMethodology: ReportMethodology = {
  returnMethod: 'daily_modified_dietz_chained',
  externalFlowTiming: 'midpoint_approximation',
  annualized: false,
  gapHandling: 'unavailable',
  investmentGainDefinition: 'ending_value_minus_beginning_value_minus_external_flows_minus_excluded_incentives',
  realizedGainLossDefinition: 'fifo_analytical_lot_matching',
  taxReporting: false,
  disclosure: 'Returns use daily Modified Dietz intervals chained across contiguous valuations. Deposits and withdrawals are timed at the midpoint of their day as an approximation; gaps remain unavailable, returns are not annualized, and realized gains/losses are analytical FIFO estimates, not tax reporting.',
};

/** Builds a reproducible report payload from exact-decimal valuation output. */
export function buildReportSnapshotPayload(input: { history: ValuationHistory; activityCoveredThrough: IsoDate | null; pricesThrough: IsoDate | null; priceDependencies?: PriceDependency[]; ledger?: Pick<LedgerResult, 'netDeposits' | 'dividendIncome' | 'realizedGainLoss'> & Partial<Pick<LedgerResult, 'sales'>> }): ReportSnapshotPayload {
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
    unavailableDates: input.history.valuations.filter((valuation) => valuation.totalValue === null || valuation.return.return === null || !valuation.canChainFromPrevious).map((valuation) => ({ date: valuation.date, reason: !valuation.canChainFromPrevious ? 'non_contiguous_period' : valuation.return.unavailableReason ?? 'missing_valuation' })),
    priceDependencies: input.priceDependencies ?? [],
    methodology: reportMethodology,
  };
}
