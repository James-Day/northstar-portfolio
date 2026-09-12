import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRobinhoodActivityCsv } from '@/services/ingestion/robinhood';

const csv = readFileSync(new URL('../../fixtures/robinhood/full-portfolio-activity.csv', import.meta.url), 'utf8');

describe('full Robinhood activity export fixture', () => {
  it('parses multiline descriptions and all 559 transaction rows', () => {
    const rows = parseRobinhoodActivityCsv(csv);
    expect(rows).toHaveLength(559);
    expect(rows.every((row) => row.status === 'supported')).toBe(true);
    expect(new Set(rows.flatMap((row) => row.activity?.symbol ?? [])).size).toBe(42);
    expect(rows[0]).toMatchObject({ rowNumber: 2, activity: { effectiveDate: '2025-04-03', symbol: 'VOO', type: 'buy' } });
    const dates = rows.flatMap((row) => row.activity?.effectiveDate ?? []);
    expect(Math.min(...dates.map((date) => Date.parse(date)))).toBe(Date.parse('2020-03-03'));
    expect(Math.max(...dates.map((date) => Date.parse(date)))).toBe(Date.parse('2025-04-03')); 
  });
});