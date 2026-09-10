import { isoDate, type IsoDate } from '@/lib/domain/types';

const NEW_YORK = 'America/New_York';

export type UsEquityCalendarOverrides = {
  /** Explicit full-day closures supplied by an operator or exchange feed. */
  closedDates?: ReadonlySet<IsoDate>;
  /** Explicit sessions that should remain open despite a standard holiday rule. */
  openDates?: ReadonlySet<IsoDate>;
};

/**
 * Covers standard full-day NYSE holidays. Extraordinary closures and early
 * closes are intentionally not treated as full closures and must be added as
 * explicit overrides when they occur.
 */
export function isUsEquityTradingDay(date: IsoDate, overrides: UsEquityCalendarOverrides = {}): boolean {
  if (overrides.closedDates?.has(date)) return false;
  if (overrides.openDates?.has(date)) return true;
  const value = parseDate(date);
  const weekday = value.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !standardUsEquityHolidays(value.getUTCFullYear()).has(date);
}

/** Returns the New York trading date only after the regular session has closed. */
export function eligibleEodTradingDate(now: Date, minimumHourEastern = 18, overrides: UsEquityCalendarOverrides = {}): IsoDate | null {
  if (!Number.isInteger(minimumHourEastern) || minimumHourEastern < 16 || minimumHourEastern > 23) {
    throw new Error('EOD refresh hour must be an Eastern hour from 16 through 23.');
  }
  const eastern = easternDateTime(now);
  if (eastern.hour < minimumHourEastern) return null;
  const date = isoDate(`${eastern.year}-${String(eastern.month).padStart(2, '0')}-${String(eastern.day).padStart(2, '0')}`);
  return isUsEquityTradingDay(date, overrides) ? date : null;
}

function standardUsEquityHolidays(year: number): Set<IsoDate> {
  const holidays = [
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    addDays(easterSunday(year), -2), // Good Friday
    lastWeekday(year, 5, 1), // Memorial Day
    observedFixedHoliday(year, 6, 19), // Juneteenth (NYSE since 2022)
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ];
  return new Set(holidays.map(toIsoDate));
}

function parseDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toIsoDate(date: Date): IsoDate {
  return isoDate(date.toISOString().slice(0, 10));
}

function observedFixedHoliday(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 6) return addDays(date, -1);
  if (date.getUTCDay() === 0) return addDays(date, 1);
  return date;
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (occurrence - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

function addDays(date: Date, count: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + count);
  return copy;
}

function easterSunday(year: number): Date {
  const goldenNumber = year % 19;
  const century = Math.floor(year / 100);
  const yearInCentury = year % 100;
  const leapCenturies = Math.floor(century / 4);
  const centuryRemainder = century % 4;
  const lunarCorrection = Math.floor((century + 8) / 25);
  const epactCorrection = Math.floor((century - lunarCorrection + 1) / 3);
  const epact = (19 * goldenNumber + century - leapCenturies - epactCorrection + 15) % 30;
  const leapYears = Math.floor(yearInCentury / 4);
  const yearRemainder = yearInCentury % 4;
  const weekdayCorrection = (32 + 2 * centuryRemainder + 2 * leapYears - epact - yearRemainder) % 7;
  const monthShift = Math.floor((goldenNumber + 11 * epact + 22 * weekdayCorrection) / 451);
  const month = Math.floor((epact + weekdayCorrection - 7 * monthShift + 114) / 31);
  const day = (epact + weekdayCorrection - 7 * monthShift + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function easternDateTime(now: Date): { year: number; month: number; day: number; hour: number } {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((value) => value.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour') };
}
