import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRobinhoodActivityCsv, type ParsedRobinhoodRow } from '@/services/ingestion/robinhood';
import { reconcileAcceptedFixture, type AcceptedFixtureExpectation } from '@/services/ingestion/accepted-fixture-gate';
import Decimal from 'decimal.js';

const manifest = JSON.parse(readFileSync(new URL('../../fixtures/robinhood/accepted-fixtures.json', import.meta.url), 'utf8')) as Record<string, AcceptedFixtureExpectation>;

describe('accepted Robinhood fixture gate', () => {
  it.each(Object.entries(manifest))('reconciles every supported row in %s against independent quantity and cash evidence', (fileName, expected) => {
    const csv = readFileSync(new URL(`../../fixtures/robinhood/${fileName}`, import.meta.url), 'utf8');
    const result = reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), expected);
    expect(result.rowCount).toBe(expected.rows.length);
    expect(result.cashAmount).toBe(expected.rows.reduce((total, row) => total.plus(row.amount), new Decimal(0)).toFixed());
    expect(result.dividendIncome).toBe(expected.rows.filter((row) => row.type === 'dividend').reduce((total, row) => total.plus(row.amount), new Decimal(0)).toFixed());
    expect(Object.values(result.quantitiesBySymbol)).not.toContain('NaN');
  });

  it('fails closed when malformed or unsupported source rows are presented as accepted', () => {
    const malformed = parseRobinhoodActivityCsv('Activity Date,Trans Code,Instrument,Quantity,Amount\n2026-01-02,Buy,VTI,1,not-money');
    expect(() => reconcileAcceptedFixture(malformed, { resolvedSymbols: ['VTI'], rows: [{ rowNumber: 2, type: 'buy', symbol: 'VTI', quantity: '1', amount: '-100' }] })).toThrow(/invalid/);

    const unsupported = parseRobinhoodActivityCsv('Activity Date,Trans Code,Instrument,Quantity,Amount\n2026-01-02,BUY,UNKNOWN,1,($100)');
    expect(() => reconcileAcceptedFixture(unsupported, { resolvedSymbols: ['VTI'], rows: [{ rowNumber: 2, type: 'buy', symbol: 'UNKNOWN', quantity: '1', amount: '-100' }] })).toThrow(/no resolved instrument/);

    const unknownCode = parseRobinhoodActivityCsv('Activity Date,Trans Code,Amount\n2026-01-02,Corporate Mystery,$100');
    expect(() => reconcileAcceptedFixture(unknownCode as ParsedRobinhoodRow[], { resolvedSymbols: [], rows: [{ rowNumber: 2, type: 'interest', symbol: null, quantity: null, amount: '100' }] })).toThrow(/unsupported/);
  });

  it('counts an explicit dividend once when it is followed by a DRIP buy', () => {
    const csv = 'Activity Date,Trans Code,Instrument,Quantity,Amount\n2026-01-02,CDIV,VTI,,0.24\n2026-01-02,Buy,VTI,0.0008,-0.24';
    const result = reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), {
      resolvedSymbols: ['VTI'],
      rows: [
        { rowNumber: 2, type: 'dividend', symbol: 'VTI', quantity: null, amount: '0.24' },
        { rowNumber: 3, type: 'buy', symbol: 'VTI', quantity: '0.0008', amount: '-0.24' },
      ],
    });
    expect(result.dividendIncome).toBe('0.24');
    expect(result.cashAmount).toBe('0');
  });

  it('fails closed when a supported activity has the wrong cash direction', () => {
    const rows = parseRobinhoodActivityCsv('Activity Date,Trans Code,Instrument,Quantity,Amount\n2026-01-02,Buy,VTI,1,-100');
    const malformed = [{ ...rows[0], activity: rows[0].activity && { ...rows[0].activity, amount: '100' as never } }];
    expect(() => reconcileAcceptedFixture(malformed, {
      resolvedSymbols: ['VTI'],
      rows: [{ rowNumber: 2, type: 'buy', symbol: 'VTI', quantity: '1', amount: '100' }],
    })).toThrow(/invalid positive cash amount/);
  });

  it('reconciles split evidence without treating the corporate action as cash activity', () => {
    const csv = [
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount',
      '2024-10-01,Buy,SCHD,10,$70,($700)',
      '2024-10-11,SPL,SCHD,20,,,',
    ].join('\n');
    const result = reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), {
      resolvedSymbols: ['SCHD'],
      rows: [
        { rowNumber: 2, type: 'buy', symbol: 'SCHD', quantity: '10', amount: '-700' },
        { rowNumber: 3, type: 'split', symbol: 'SCHD', quantity: '20', amount: '0', splitRatio: { numerator: '3', denominator: '1' } },
      ],
    });
    expect(result.cashAmount).toBe('-700');
    expect(result.quantitiesBySymbol).toEqual({ SCHD: '30' });
  });

  it('rejects split share additions that do not match the declared ratio', () => {
    const parsed = parseRobinhoodActivityCsv([
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount',
      '2024-10-01,Buy,SCHD,10,$70,($700)',
      '2024-10-11,SPL,SCHD,10,,,',
    ].join('\n'));
    const rows = [parsed[0], { ...parsed[1], activity: parsed[1].activity && { ...parsed[1].activity, corporateAction: { type: 'split' as const, ratioNumerator: '3' as never, ratioDenominator: '1' as never } } }];
    expect(() => reconcileAcceptedFixture(rows, {
      resolvedSymbols: ['SCHD'],
      rows: [
        { rowNumber: 2, type: 'buy', symbol: 'SCHD', quantity: '10', amount: '-700' },
        { rowNumber: 3, type: 'split', symbol: 'SCHD', quantity: '10', amount: '0', splitRatio: { numerator: '3', denominator: '1' } },
      ],
    })).toThrow(/split quantity/);
  });

  it('uses the post-split position when reconciling later activity', () => {
    const csv = [
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount',
      '2024-10-01,Buy,SCHD,10,$70,($700)',
      '2024-10-11,SPL,SCHD,20,,,',
      '2024-10-14,Sell,SCHD,1,$35,$35',
    ].join('\n');
    const result = reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), {
      resolvedSymbols: ['SCHD'],
      rows: [
        { rowNumber: 2, type: 'buy', symbol: 'SCHD', quantity: '10', amount: '-700' },
        { rowNumber: 3, type: 'split', symbol: 'SCHD', quantity: '20', amount: '0', splitRatio: { numerator: '3', denominator: '1' } },
        { rowNumber: 4, type: 'sell', symbol: 'SCHD', quantity: '1', amount: '35' },
      ],
    });
    expect(result.quantitiesBySymbol).toEqual({ SCHD: '29' });
    expect(result.cashAmount).toBe('-665');
  });

  it('fails closed when a fixture sells more shares than its reconciled position', () => {
    const csv = [
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount',
      '2026-01-02,Buy,VTI,1,$100,($100)',
      '2026-01-03,Sell,VTI,1.1,$100,$110',
    ].join('\n');
    expect(() => reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), {
      resolvedSymbols: ['VTI'],
      rows: [
        { rowNumber: 2, type: 'buy', symbol: 'VTI', quantity: '1', amount: '-100' },
        { rowNumber: 3, type: 'sell', symbol: 'VTI', quantity: '1.1', amount: '110' },
      ],
    })).toThrow(/sells more VTI shares/);
  });

  it('fails closed when a split row has no inferred corporate-action ratio', () => {
    const csv = [
      'Activity Date,Trans Code,Instrument,Quantity,Price,Amount',
      '2026-01-02,SPL,VTI,1,,,',
    ].join('\n');
    expect(() => reconcileAcceptedFixture(parseRobinhoodActivityCsv(csv), {
      resolvedSymbols: ['VTI'],
      rows: [{ rowNumber: 2, type: 'split', symbol: 'VTI', quantity: '1', amount: '0' }],
    })).toThrow(/no validated split ratio/);
  });
});
