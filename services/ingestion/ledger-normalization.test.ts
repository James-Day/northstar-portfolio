import { describe, expect, it } from 'vitest';
import { parseRobinhoodActivityCsv } from '@/services/ingestion/robinhood';
import { normalizeRobinhoodRowsForLedger } from '@/services/ingestion/ledger-normalization';
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { applyFifoLedger, type LedgerEvent } from '@/services/ledger/fifo';
import { decimalString } from '@/lib/domain/money';

describe('Robinhood ledger normalization', () => {
  it('counts separately reported dividend plus reinvestment buy as one dividend', () => {
    const csv = readFileSync(new URL('../../fixtures/robinhood/individual-activity.csv', import.meta.url), 'utf8');
    const rows = parseRobinhoodActivityCsv(csv);
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([['VTI', 'instrument-vti']]));

    expect(entries.filter((entry) => entry.entryType === 'dividend')).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === 'buy')).toHaveLength(2);
    expect(entries.filter((entry) => entry.entryType === 'dividend')[0]).toMatchObject({ cashAmount: '0.24', externalFlow: false });
    expect(entries.filter((entry) => entry.entryType === 'buy').at(-1)).toMatchObject({ quantity: '0.0008', cashAmount: '-0.24' });
  });

  it.each([
    ['traditional IRA', 'traditional-ira-activity.csv', 'SCHD'],
    ['Roth IRA', 'roth-ira-activity.csv', 'VOO'],
  ])('preserves %s incentive, transfer, fee, and fractional activity semantics', (_name, fileName, symbol) => {
    const csv = readFileSync(new URL(`../../fixtures/robinhood/${fileName}`, import.meta.url), 'utf8');
    const rows = parseRobinhoodActivityCsv(csv);
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([[symbol, `instrument-${symbol.toLowerCase()}`]]));

    expect(entries.filter((entry) => entry.entryType === 'dividend')).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === 'drip_buy')).toHaveLength(0);
    expect(entries.filter((entry) => entry.entryType === 'ira_incentive')).toHaveLength(fileName.startsWith('traditional') ? 1 : 0);
    expect(entries.filter((entry) => entry.entryType === 'transfer_in')).toHaveLength(fileName.startsWith('roth') ? 1 : 0);
    expect(entries.filter((entry) => entry.entryType === 'transfer_out')).toHaveLength(fileName.startsWith('roth') ? 1 : 0);
    expect(entries.filter((entry) => entry.entryType === 'fee')).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === 'deposit')[0].externalFlow).toBe(true);
  });

  it('expands a DRIP into dividend income and a separate cash-neutral buy', () => {
    const rows = parseRobinhoodActivityCsv('Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description\n2026-01-02,Dividend Reinvestment,VTI,0.01,$200,($2),Reinvested dividend');
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([['VTI', 'instrument-vti']]));

    expect(entries).toEqual([
      expect.objectContaining({ entryType: 'dividend', instrumentId: 'instrument-vti', quantity: null, cashAmount: '2', description: 'Reinvested dividend (reinvested dividend income)' }),
      expect.objectContaining({ entryType: 'drip_buy', instrumentId: 'instrument-vti', quantity: '0.01', cashAmount: '-2' }),
    ]);
  });

  it('does not duplicate income when Robinhood reports both dividend and DRIP rows', () => {
    const rows = parseRobinhoodActivityCsv([
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description',
      '2026-01-02,CDIV,VTI,,,($2),Cash dividend',
      '2026-01-02,Dividend Reinvestment,VTI,0.01,$200,($2),Reinvested dividend',
    ].join('\n'));
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([['VTI', 'instrument-vti']]));
    expect(entries.filter((entry) => entry.entryType === 'dividend')).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === 'drip_buy')).toHaveLength(1);
  });

  it('keeps a supported stock split out of the cash and lot ledger projection', () => {
    const rows = parseRobinhoodActivityCsv([
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description',
      '2024-10-01,Buy,SCHD,10,$70,($700),Bought before split',
      '2024-10-11,SPL,SCHD,20,,,Stock split',
    ].join('\n'));
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([['SCHD', 'instrument-schd']]));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryType: 'buy', cashAmount: '-700', quantity: '10' });
    expect(entries.some((entry) => entry.entryType === 'split')).toBe(false);
  });

  it('preserves signs for cash activity and marks only deposits and withdrawals as external flows', () => {
    const rows = parseRobinhoodActivityCsv('Activity Date,Trans Code,Amount\n2026-01-02,ACH Deposit,$100\n2026-01-03,IRA Incentive,$10\n2026-01-04,ACH Withdrawal,$5\n2026-01-05,Fee,$1');
    expect(normalizeRobinhoodRowsForLedger(rows, new Map())).toEqual([
      expect.objectContaining({ entryType: 'deposit', cashAmount: '100', externalFlow: true }),
      expect.objectContaining({ entryType: 'ira_incentive', cashAmount: '10', externalFlow: false }),
      expect.objectContaining({ entryType: 'withdrawal', cashAmount: '-5', externalFlow: true }),
      expect.objectContaining({ entryType: 'fee', cashAmount: '-1', externalFlow: false }),
    ]);
  });

  it('fails closed when a reportable ticker has not been resolved to a stable instrument ID', () => {
    const rows = parseRobinhoodActivityCsv('Activity Date,Trans Code,Instrument,Quantity,Amount\n2026-01-02,Buy,VTI,1,($100)');
    expect(() => normalizeRobinhoodRowsForLedger(rows, new Map())).toThrow('no resolved instrument for VTI');
  });

  it('normalizes trades, dividends, interest, fees, IRA flows, and transfers without changing signs', () => {
    const rows = parseRobinhoodActivityCsv([
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount,Description',
      '2026-01-02,Buy,VTI,1,$100,($100),Bought VTI',
      '2026-01-03,Sell,VTI,0.5,$120,$60,Sold VTI',
      '2026-01-04,CDIV,VTI,,,($2.50),Cash dividend',
      '2026-01-05,SLIP,,,, $0.10,Interest',
      '2026-01-06,AFEE,,,,($1.25),Regulatory fee',
      '2026-01-07,IRA Contribution,,,,$500,IRA contribution',
      '2026-01-08,IRA Distribution,,,,($50),IRA distribution',
      '2026-01-09,Transfer In,,,,$20,Transfer in',
      '2026-01-10,Transfer Out,,,,($5),Transfer out',
    ].join('\n'));
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([['VTI', 'instrument-vti']]));
    expect(entries).toMatchObject([
      { entryType: 'buy', instrumentId: 'instrument-vti', quantity: '1', cashAmount: '-100', externalFlow: false },
      { entryType: 'sell', instrumentId: 'instrument-vti', quantity: '0.5', cashAmount: '60', externalFlow: false },
      { entryType: 'dividend', instrumentId: 'instrument-vti', cashAmount: '2.5', externalFlow: false },
      { entryType: 'interest', cashAmount: '0.1', externalFlow: false },
      { entryType: 'fee', cashAmount: '-1.25', externalFlow: false },
      { entryType: 'deposit', cashAmount: '500', externalFlow: true },
      { entryType: 'withdrawal', cashAmount: '-50', externalFlow: true },
      { entryType: 'transfer_in', cashAmount: '20', externalFlow: false },
      { entryType: 'transfer_out', cashAmount: '-5', externalFlow: false },
    ]);
  });

  it.each([
    ['individual', 'individual-activity.csv', 'VTI', { cash: '415.98', dividendIncome: '0.24', netDeposits: '460', realizedGainLoss: '1', shares: '0.1508' }],
    ['traditional IRA', 'traditional-ira-activity.csv', 'SCHD', { cash: '698.47', dividendIncome: '0.78', netDeposits: '900', realizedGainLoss: '1', shares: '2.5091' }],
    ['Roth IRA', 'roth-ira-activity.csv', 'VOO', { cash: '712.75', dividendIncome: '0.55', netDeposits: '750', realizedGainLoss: '1.25', shares: '0.3761' }],
  ])('reconciles %s normalized activity through the FIFO calculation boundary', (_name, fileName, symbol, expected) => {
    const rows = parseRobinhoodActivityCsv(readFileSync(new URL(`../../fixtures/robinhood/${fileName}`, import.meta.url), 'utf8'));
    const entries = normalizeRobinhoodRowsForLedger(rows, new Map([[symbol, `instrument-${symbol.toLowerCase()}`]]));
    const events: LedgerEvent[] = entries.map((entry) => {
      const amount = decimalString(new Decimal(entry.cashAmount).abs().toFixed());
      if (entry.entryType === 'buy' || entry.entryType === 'drip_buy' || entry.entryType === 'sell') {
        return { id: `${fileName}-${entry.sourceRowNumber}`, date: entry.effectiveDate, type: entry.entryType, instrumentId: entry.instrumentId!, quantity: entry.quantity!, grossAmount: amount, fee: decimalString('0') };
      }
      if (entry.entryType === 'dividend') return { id: `${fileName}-${entry.sourceRowNumber}`, date: entry.effectiveDate, type: 'dividend', instrumentId: entry.instrumentId ?? undefined, amount };
      return { id: `${fileName}-${entry.sourceRowNumber}`, date: entry.effectiveDate, type: entry.entryType, amount } as LedgerEvent;
    });
    const result = applyFifoLedger(events);

    expect(result).toMatchObject({ cash: expected.cash, dividendIncome: expected.dividendIncome, netDeposits: expected.netDeposits, realizedGainLoss: expected.realizedGainLoss });
    expect(result.openLots.filter((lot) => lot.instrumentId === `instrument-${symbol.toLowerCase()}`).reduce((sum, lot) => sum.plus(lot.remainingQuantity), new Decimal(0)).toFixed()).toBe(expected.shares);
    expect(result.dividendEvents).toHaveLength(1);
    expect(result.sales).toHaveLength(1);
  });
});
