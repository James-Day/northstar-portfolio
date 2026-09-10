import { isoDate, type IsoDate } from '@/lib/domain/types';
import type { UsEquityCalendarOverrides } from '@/services/market-data/us-equity-calendar';

/** Parses operator supplied ISO dates from a Worker variable such as `2026-12-24,2026-12-26`. */
export function parseCalendarOverrideDates(value: string | undefined, name: string): ReadonlySet<IsoDate> {
  if (!value?.trim()) return new Set<IsoDate>();
  const dates = value.split(',').map((part) => part.trim()).filter(Boolean);
  const parsed = dates.map((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${name} must contain comma-separated YYYY-MM-DD dates.`);
    const normalized = isoDate(date);
    if (normalized !== date) throw new Error(`${name} contains an invalid calendar date.`);
    return normalized;
  });
  return new Set(parsed);
}

export function readCalendarOverrides(environment: { MARKET_CALENDAR_CLOSED_DATES?: string; MARKET_CALENDAR_OPEN_DATES?: string }): UsEquityCalendarOverrides {
  return {
    closedDates: parseCalendarOverrideDates(environment.MARKET_CALENDAR_CLOSED_DATES, 'MARKET_CALENDAR_CLOSED_DATES'),
    openDates: parseCalendarOverrideDates(environment.MARKET_CALENDAR_OPEN_DATES, 'MARKET_CALENDAR_OPEN_DATES'),
  };
}
