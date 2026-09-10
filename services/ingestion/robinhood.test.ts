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

  it('handles verified Robinhood compact codes and ignores fully blank CSV records', () => {
    const rows = parseRobinhoodActivityCsv([
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description',
      '5/16/2025,CDIV,COST,,,"$1.30","Cash Div: R/D 2025-05-02 P/D 2025-05-16"',
      '5/16/2025,AFEE,ARM,,,"($0.02)","ADR Fee: R/D 2024-08-27"',
      '5/16/2025,SLIP,SCHD,,,"$0.01",Stock Lending',
      '5/16/2025,ACH,,,,"$500.00",ACH Deposit',
      '5/16/2025,ACH,,,,"($50.00)",ACH Withdrawal',
      ',,,,,,',
      '5/16/2025,SPL,SCHD,20,,,Stock split',
    ].join('\n'));

    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 5)).toMatchObject([
      { status: 'supported', activity: { type: 'dividend', amount: '1.3' } },
      { status: 'supported', activity: { type: 'fee', amount: '-0.02' } },
      { status: 'supported', activity: { type: 'interest', amount: '0.01' } },
      { status: 'supported', activity: { type: 'deposit', amount: '500' } },
      { status: 'supported', activity: { type: 'withdrawal', amount: '-50' } },
    ]);
    expect(rows[5]).toMatchObject({ status: 'unsupported', rowNumber: 8, message: expect.stringContaining('SPL') });
  });
});
