import { describe, expect, it } from 'vitest';
import { buildUsEquityValuationDates } from './valuation-dates';
import { isoDate } from '@/lib/domain/types';

describe('buildUsEquityValuationDates', () => {
  it('skips weekends and standard holidays while preserving chain anchors', () => {
    expect(buildUsEquityValuationDates({ from: isoDate('2026-07-02'), through: isoDate('2026-07-06') })).toEqual([
      { date: '2026-07-02', canChainFromPrevious: false },
      { date: '2026-07-06', canChainFromPrevious: true },
    ]);
  });

  it('honors explicit exceptional sessions and bounds the range', () => {
    expect(buildUsEquityValuationDates({ from: isoDate('2026-07-04'), through: isoDate('2026-07-04'), overrides: { openDates: new Set([isoDate('2026-07-04')]) } })).toEqual([{ date: '2026-07-04', canChainFromPrevious: false }]);
    expect(() => buildUsEquityValuationDates({ from: isoDate('2026-01-01'), through: isoDate('2026-01-10'), maxSessions: 2 })).toThrow('session limit');
  });
});
