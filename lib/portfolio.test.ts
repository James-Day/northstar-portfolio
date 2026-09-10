import { describe, expect, it } from 'vitest';
import { parseRobinhoodCsv } from '@/lib/portfolio';

describe('browser Robinhood CSV preview', () => {
  it('uses the same quoted and multiline parser as the server importer', () => {
    const rows = parseRobinhoodCsv([
      '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"',
      '"4/3/2025","4/3/2025","4/4/2025","VOO","Vanguard S&P 500 ETF\nCUSIP: 922908363","Buy","0.5","$498.29","($249.14)"',
      '"4/3/2025","4/3/2025","4/4/2025","","ACH Deposit","ACH","","","$500.00"',
    ].join('\n'));
    expect(rows).toMatchObject([
      { date: '2025-04-03', kind: 'buy', symbol: 'VOO', quantity: 0.5, amount: -249.14 },
      { date: '2025-04-03', kind: 'deposit', amount: 500 },
    ]);
  });

  it('reports missing required columns clearly', () => {
    expect(() => parseRobinhoodCsv('Activity,Type\n4/3/2025,Buy')).toThrow('missing the required activity date column');
  });
});
