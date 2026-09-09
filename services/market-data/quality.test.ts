import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { inspectPriceRecords } from '@/services/market-data/quality';

const d = decimalString;

describe('price quality', () => {
  it('quarantines duplicate dates and extreme unadjusted changes for review', () => {
    const result = inspectPriceRecords([
      { instrumentId: 'aapl', tradingDate: isoDate('2026-01-02'), close: d('100') },
      { instrumentId: 'aapl', tradingDate: isoDate('2026-01-03'), close: d('20') },
      { instrumentId: 'aapl', tradingDate: isoDate('2026-01-03'), close: d('20') },
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.quarantined).toHaveLength(2);
    expect(result.quarantined.flatMap((record) => record.issues.map((issue) => issue.reason))).toContain('duplicate_date');
    expect(result.quarantined.flatMap((record) => record.issues.map((issue) => issue.reason))).toContain('extreme_close_change');
  });

  it('keeps ordinary positive price history available for valuation', () => {
    const result = inspectPriceRecords([
      { instrumentId: 'vti', tradingDate: isoDate('2026-01-02'), close: d('100') },
      { instrumentId: 'vti', tradingDate: isoDate('2026-01-03'), close: d('101') },
    ]);
    expect(result).toMatchObject({ accepted: [{ close: '100' }, { close: '101' }], quarantined: [] });
  });
});
