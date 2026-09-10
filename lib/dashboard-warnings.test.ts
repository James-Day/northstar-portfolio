import { describe, expect, it } from 'vitest';
import { getDashboardWarnings } from '@/lib/dashboard-warnings';

const base = { isLiveAccount: true, reportLoading: false };

describe('dashboard warning states', () => {
  it('explains a missing report and offers the import action', () => {
    expect(getDashboardWarnings(base)).toEqual([expect.objectContaining({ kind: 'missing_report', action: 'import' })]);
  });

  it('distinguishes stale reports from unavailable prices', () => {
    const warnings = getDashboardWarnings({ ...base, report: { asOfDate: '2026-09-09', totalValue: '100', holdings: [{ quantity: '1' }] }, freshness: { expectedDate: '2026-09-10', rows: [{ status: 'stale' }] } });
    expect(warnings.map((warning) => warning.kind)).toEqual(['stale_report']);
    const unavailable = getDashboardWarnings({ ...base, report: { asOfDate: '2026-09-10', totalValue: null, holdings: [{ quantity: '1' }] }, freshness: { expectedDate: '2026-09-10', rows: [{ status: 'missing' }] } });
    expect(unavailable.map((warning) => warning.kind)).toEqual(['unavailable_prices']);
  });

  it('shows partial history and no holdings as separate states', () => {
    const warnings = getDashboardWarnings({ ...base, report: { asOfDate: '2026-09-10', totalValue: '20', holdings: [] }, openingHistory: { incompleteReason: 'The first statement starts later.', positions: [{ acquiredOn: null, totalCostBasis: null }] } });
    expect(warnings.map((warning) => warning.kind)).toEqual(['partial_history', 'no_holdings']);
    expect(warnings.find((warning) => warning.kind === 'partial_history')?.action).toBe('accounts');
  });

  it('does not show live warnings for the synthetic demo', () => {
    expect(getDashboardWarnings({ ...base, isLiveAccount: false })).toEqual([]);
  });
});
