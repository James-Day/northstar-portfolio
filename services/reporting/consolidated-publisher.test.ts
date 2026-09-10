import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { publishConsolidatedReportSnapshot } from '@/services/reporting/consolidated-publisher';

const account = (id: string): { accountId: string; inputs: PersistedReportInputs } => ({
  accountId: id,
  inputs: {
    valuation: { dates: [{ date: isoDate('2026-01-05'), canChainFromPrevious: false }], events: [], openingLots: [], closes: [], corporateActions: [] },
    ledger: { cash: decimalString('10'), openLots: [], realizedGainLoss: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('10'), sales: [] },
    activityCoveredThrough: isoDate('2026-01-04'), pricesThrough: isoDate('2026-01-05'), importStateRevision: `ledger:${id}`,
  },
});

describe('consolidated report publisher', () => {
  it('publishes a null-account consolidated snapshot with deterministic revision metadata', async () => {
    const publish = vi.fn().mockResolvedValue('snapshot-1');
    await expect(publishConsolidatedReportSnapshot({ publisher: { publish }, userId: 'user-1', accounts: [account('a'), account('b')], priceRevisionId: 'price-1' as never })).resolves.toMatchObject({ snapshotId: 'snapshot-1', importStateRevision: 'consolidated:ledger:a|ledger:b', asOfDate: '2026-01-05' });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ accountId: null, reportType: 'consolidated_daily', importStateRevision: 'consolidated:ledger:a|ledger:b', priceRevisionId: 'price-1' }));
  });
});
