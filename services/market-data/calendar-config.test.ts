import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/domain/types';
import { parseCalendarOverrideDates, readCalendarOverrides } from '@/services/market-data/calendar-config';

describe('calendar override configuration', () => {
  it('parses and deduplicates operator dates', () => {
    expect([...parseCalendarOverrideDates('2026-12-24, 2026-12-24', 'CLOSED')]).toEqual(['2026-12-24']);
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => parseCalendarOverrideDates('12/24/2026', 'CLOSED')).toThrow('YYYY-MM-DD');
    expect(() => parseCalendarOverrideDates('2026-02-30', 'CLOSED')).toThrow('Invalid calendar date');
  });

  it('builds both override sets for the scheduler', () => {
    const overrides = readCalendarOverrides({ MARKET_CALENDAR_CLOSED_DATES: '2026-07-03', MARKET_CALENDAR_OPEN_DATES: '2026-11-27' });
    expect(overrides.closedDates?.has(isoDate('2026-07-03'))).toBe(true);
    expect(overrides.openDates?.has(isoDate('2026-11-27'))).toBe(true);
  });
});
