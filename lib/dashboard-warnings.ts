export type DashboardWarningKind =
  | 'missing_report'
  | 'stale_report'
  | 'partial_history'
  | 'unavailable_prices'
  | 'no_holdings';

export type DashboardWarning = {
  kind: DashboardWarningKind;
  title: string;
  message: string;
  action: 'import' | 'accounts' | 'retry';
};

type WarningInput = {
  isLiveAccount: boolean;
  reportLoading: boolean;
  reportError?: string;
  report?: {
    asOfDate: string;
    totalValue: string | null;
    holdings: Array<{ quantity: string }>;
  };
  freshness?: {
    expectedDate: string;
    rows: Array<{ status: 'current' | 'stale' | 'missing' }>;
  };
  openingHistory?: {
    incompleteReason: string | null;
    positions: Array<{ acquiredOn: string | null; totalCostBasis: string | null }>;
  };
};

/**
 * Produces user-facing dashboard states without guessing values. The API and
 * persisted snapshot remain the source of truth; this function only decides
 * which explanation and next action should be shown.
 */
export function getDashboardWarnings(input: WarningInput): DashboardWarning[] {
  if (!input.isLiveAccount) return [];
  const warnings: DashboardWarning[] = [];
  const hasReport = input.report !== undefined;
  const hasStalePrices = input.freshness?.rows.some((row) => row.status === 'stale') ?? false;
  const hasMissingPrices = input.freshness?.rows.some((row) => row.status === 'missing') ?? false;
  const reportIsStale = hasReport && input.freshness !== undefined && input.report.asOfDate < input.freshness.expectedDate;
  const hasPartialHistory = Boolean(
    input.openingHistory?.incompleteReason ||
      input.openingHistory?.positions.some((position) => position.acquiredOn === null || position.totalCostBasis === null),
  );

  if (!input.reportLoading && !input.reportError && !hasReport) {
    warnings.push({
      kind: 'missing_report',
      title: 'Your report is not ready yet',
      message: 'Import a Robinhood activity CSV to create your first persisted report.',
      action: 'import',
    });
  }
  if (reportIsStale || hasStalePrices) {
    warnings.push({
      kind: 'stale_report',
      title: 'Your report is out of date',
      message: 'Some stored prices or the latest report do not cover the most recent expected trading day.',
      action: 'retry',
    });
  }
  if (hasPartialHistory) {
    warnings.push({
      kind: 'partial_history',
      title: 'Your history is incomplete',
      message: 'Add an opening balance or explain the missing history so returns and cost basis are clearly labeled.',
      action: 'accounts',
    });
  }
  if (input.report?.totalValue === null || hasMissingPrices) {
    warnings.push({
      kind: 'unavailable_prices',
      title: 'Portfolio value is temporarily unavailable',
      message: 'At least one held instrument has no usable close for this valuation date. We will not estimate its value.',
      action: 'retry',
    });
  }
  if (hasReport && input.report.holdings.length === 0) {
    warnings.push({
      kind: 'no_holdings',
      title: 'No current holdings yet',
      message: 'Your imported activity currently leaves no open positions. Cash and completed sales remain available in your report.',
      action: 'import',
    });
  }
  return warnings;
}
