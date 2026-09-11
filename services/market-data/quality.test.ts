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

  it('quarantines malformed closes instead of throwing or blocking other symbols', () => {
    const result = inspectPriceRecords([
      { instrumentId: 'bad', tradingDate: isoDate('2026-01-02'), close: 'not-a-number' as never },
      { instrumentId: 'good', tradingDate: isoDate('2026-01-02'), close: d('42') },
    ]);
    expect(result.accepted).toEqual([{ instrumentId: 'good', tradingDate: '2026-01-02', close: '42' }]);
    expect(result.quarantined[0]?.issues).toEqual([expect.objectContaining({ reason: 'invalid_close' })]);
  });

  it('does not compare a valid close against a quarantined non-positive close', () => {
    const result = inspectPriceRecords([
      { instrumentId: 'fund', tradingDate: isoDate('2026-01-02'), close: d('0') },
      { instrumentId: 'fund', tradingDate: isoDate('2026-01-03'), close: d('100') },
    ]);
    expect(result.accepted).toEqual([{ instrumentId: 'fund', tradingDate: '2026-01-03', close: '100' }]);
    expect(result.quarantined).toEqual([expect.objectContaining({ tradingDate: '2026-01-02', issues: [expect.objectContaining({ reason: 'invalid_close' })] })]);
  });
});
