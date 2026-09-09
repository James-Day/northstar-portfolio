import { describe, expect, it } from 'vitest';
import { parseRobinhoodActivityCsv } from '@/services/ingestion/robinhood';

describe('parseRobinhoodActivityCsv', () => {
  it('handles BOM, quoted commas, decimals, parentheses, and exact transaction codes', () => {
    const rows = parseRobinhoodActivityCsv('\uFEFFActivity Date,Trans Code,Instrument,Quantity,Price,Amount,Description\n01/02/2026,Buy,VTI,1.25,"$100.00","($125.00)","Market buy, limit order"\n01/03/2026,Cash Dividend,VTI,,,"$2.50",Dividend');
    expect(rows[0]).toMatchObject({ status: 'supported', activity: { effectiveDate: '2026-01-02', type: 'buy', symbol: 'VTI', quantity: '1.25', amount: '-125', description: 'Market buy, limit order' } });
    expect(rows[1]).toMatchObject({ status: 'supported', activity: { type: 'dividend', amount: '2.5' } });
  });

  it('preserves unfamiliar codes as visible unsupported rows', () => {
    const [row] = parseRobinhoodActivityCsv('Activity Date,Trans Code,Amount\n2026-01-02,Corporate Mystery,"$2.00"');
    expect(row).toMatchObject({ status: 'unsupported', rowNumber: 2, message: expect.stringContaining('Corporate Mystery') });
  });

  it('preserves malformed rows as invalid rather than converting them to zero or dropping them', () => {
    const [row] = parseRobinhoodActivityCsv('Activity Date,Trans Code,Amount\n2026-01-02,Interest,not-money');
    expect(row).toMatchObject({ status: 'invalid', rowNumber: 2, message: 'Invalid amount: not-money' });
    expect(row.raw).toMatchObject({ amount: 'not-money' });
  });
});
