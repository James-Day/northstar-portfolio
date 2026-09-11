import { isoDate, type IsoDate } from '@/lib/domain/types';
import { isUsEquityTradingDay, type UsEquityCalendarOverrides } from '@/services/market-data/us-equity-calendar';
import type { ValuationDate } from '@/services/calculations/valuation';

/** Builds an explicit trading-session series for report valuation. The first
 * date is a new chain anchor; later sessions may chain only when no session
 * was skipped by the supplied calendar. */
export function buildUsEquityValuationDates(input: { from: IsoDate; through: IsoDate; overrides?: UsEquityCalendarOverrides; maxSessions?: number }): ValuationDate[] {
  const start = parse(input.from);
  const end = parse(input.through);
  if (start > end) throw new Error('Valuation start date must not be after the end date.');
  const maxSessions = input.maxSessions ?? 10_000;
  if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new Error('Valuation session limit must be positive.');
  const dates: ValuationDate[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = isoDate(cursor.toISOString().slice(0, 10));
    if (!isUsEquityTradingDay(date, input.overrides)) continue;
    dates.push({ date, canChainFromPrevious: dates.length > 0 });
    if (dates.length > maxSessions) throw new Error('Valuation session limit exceeded.');
  }
  return dates;
}

function parse(value: IsoDate): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error(`Invalid valuation date: ${value}`);
  return parsed;
}
