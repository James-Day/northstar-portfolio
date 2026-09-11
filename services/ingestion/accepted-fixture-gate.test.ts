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
});
