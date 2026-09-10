import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/domain/types';
import { eligibleEodTradingDate, isUsEquityTradingDay } from '@/services/market-data/us-equity-calendar';

describe('U.S. equity market calendar', () => {
  it('excludes weekends and standard 2026 full-day NYSE holidays', () => {
    for (const date of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25', '2026-09-06']) {
      expect(isUsEquityTradingDay(isoDate(date))).toBe(false);
    }
    expect(isUsEquityTradingDay(isoDate('2026-09-08'))).toBe(true);
  });

  it('uses New York time across daylight saving time when deciding EOD eligibility', () => {
    expect(eligibleEodTradingDate(new Date('2026-07-06T21:59:00.000Z'))).toBeNull(); // 5:59 PM EDT
    expect(eligibleEodTradingDate(new Date('2026-07-06T22:00:00.000Z'))).toBe('2026-07-06');
    expect(eligibleEodTradingDate(new Date('2026-12-07T22:59:00.000Z'))).toBeNull(); // 5:59 PM EST
    expect(eligibleEodTradingDate(new Date('2026-12-07T23:00:00.000Z'))).toBe('2026-12-07');
  });

  it('does not issue EOD work on a holiday even after the configured hour', () => {
    expect(eligibleEodTradingDate(new Date('2026-12-25T23:00:00.000Z'))).toBeNull();
    expect(() => eligibleEodTradingDate(new Date(), 15)).toThrow('from 16 through 23');
  });

  it('supports explicit extraordinary closure and session overrides', () => {
    const closed = new Set([isoDate('2026-09-08')]);
    expect(isUsEquityTradingDay(isoDate('2026-09-08'), { closedDates: closed })).toBe(false);
    expect(eligibleEodTradingDate(new Date('2026-09-08T22:00:00Z'), 18, { closedDates: closed })).toBeNull();
    expect(isUsEquityTradingDay(isoDate('2026-07-04'), { openDates: new Set([isoDate('2026-07-04')]) })).toBe(true);
  });
});
