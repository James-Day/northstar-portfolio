import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { valueLedgerHistory } from '@/services/calculations/valuation';
import { publishReportSnapshot } from '@/services/reporting/publish-snapshot';

describe('publishReportSnapshot', () => {
  it('publishes generated payload with activity, price, and import dependencies', async () => {
    const publisher = { publish: vi.fn().mockResolvedValue('snapshot-id') };
    const history = valueLedgerHistory({ dates: [{ date: isoDate('2026-01-02'), canChainFromPrevious: false }], events: [], closes: [] });
    await expect(publishReportSnapshot({ publisher, userId: 'user-1', accountId: 'account-1', reportType: 'account_daily', importStateRevision: 'import-rev', priceRevisionId: 'price-rev', history, activityCoveredThrough: isoDate('2026-01-01'), pricesThrough: isoDate('2026-01-02') })).resolves.toBe('snapshot-id');
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', accountId: 'account-1', asOfDate: '2026-01-02', importStateRevision: 'import-rev', priceRevisionId: 'price-rev', payload: expect.objectContaining({ valuationThrough: '2026-01-02' }) }));
  });

  it('does not publish an empty valuation history', async () => {
    const publisher = { publish: vi.fn() };
    const history = valueLedgerHistory({ dates: [], events: [], closes: [] });
    await expect(publishReportSnapshot({ publisher, userId: 'user-1', reportType: 'dashboard', importStateRevision: 'import-rev', history, activityCoveredThrough: null, pricesThrough: null })).rejects.toThrow('as-of valuation date');
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
