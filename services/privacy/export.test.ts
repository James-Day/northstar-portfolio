import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from './export';

describe('safe CSV export', () => {
  it('escapes CSV syntax and neutralizes formula-like values', () => {
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell('hello, "world"\nnext')).toBe('"hello, ""world""\nnext"');
  });

  it('requires rectangular rows and emits a stable trailing newline', () => {
    expect(toCsv(['date', 'amount'], [['2026-01-01', 12]])).toBe('date,amount\r\n2026-01-01,12\r\n');
    expect(() => toCsv(['date'], [['a', 'b']])).toThrow('header count');
  });
});
