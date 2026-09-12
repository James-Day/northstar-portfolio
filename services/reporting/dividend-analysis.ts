import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';

export type DividendEventInput = {
  eventId: string;
  date: string;
  instrumentId?: string;
  amount: string;
};

export type DividendPeriod = {
  period: string;
  amount: DecimalString;
  eventCount: number;
};

export type DividendProjection = DividendPeriod & {
  projected: true;
};

export type DividendAnalysis = {
  total: DecimalString;
  daily: DividendPeriod[];
  monthly: DividendPeriod[];
  yearly: DividendPeriod[];
  projectedMonthly: DividendProjection[];
  projectionMethod: 'historical_cadence' | 'insufficient_history';
};

/**
 * Produces dividend views from imported cash-income events. Projection is an
 * estimate only: for each instrument with at least two payments, it repeats
 * the average payment at the average historical interval for the next year.
 * This intentionally does not call a market-data provider or predict changes
 * to a company's announced dividend.
 */
export function analyzeDividends(events: DividendEventInput[], asOfDate?: string): DividendAnalysis {
  const valid = events
    .filter((event) => event.amount && Number.isFinite(Number(event.amount)) && Number(event.amount) >= 0)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.eventId.localeCompare(right.eventId));
  const total = valid.reduce((sum, event) => sum.plus(event.amount), new Decimal(0));
  const daily = groupBy(valid, (event) => event.date);
  const monthly = groupBy(valid, (event) => event.date.slice(0, 7));
  const yearly = groupBy(valid, (event) => event.date.slice(0, 4));
  const end = parseDate(asOfDate ?? valid.at(-1)?.date ?? new Date().toISOString().slice(0, 10));
  const projectionEvents = projectEvents(valid, end);
  const projectedMonthly = groupBy(projectionEvents, (event) => event.date.slice(0, 7)).map((row) => ({ ...row, projected: true as const }));
  return {
    total: decimalString(total),
    daily,
    monthly,
    yearly,
    projectedMonthly,
    projectionMethod: projectionEvents.length > 0 ? 'historical_cadence' : 'insufficient_history',
  };
}

function groupBy(events: DividendEventInput[], key: (event: DividendEventInput) => string): DividendPeriod[] {
  const groups = new Map<string, { amount: Decimal; eventCount: number }>();
  for (const event of events) {
    const period = key(event);
    const current = groups.get(period) ?? { amount: new Decimal(0), eventCount: 0 };
    current.amount = current.amount.plus(event.amount);
    current.eventCount += 1;
    groups.set(period, current);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, value]) => ({ period, amount: decimalString(value.amount), eventCount: value.eventCount }));
}

function projectEvents(events: DividendEventInput[], asOf: Date): DividendEventInput[] {
  const byInstrument = new Map<string, DividendEventInput[]>();
  for (const event of events) {
    if (!event.instrumentId) continue;
    const list = byInstrument.get(event.instrumentId) ?? [];
    list.push(event);
    byInstrument.set(event.instrumentId, list);
  }
  const horizon = new Date(asOf);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 1);
  const projected: DividendEventInput[] = [];
  for (const [instrumentId, history] of byInstrument) {
    if (history.length < 2) continue;
    const intervals = history.slice(1).map((event, index) => daysBetween(parseDate(history[index].date), parseDate(event.date))).filter((days) => days > 0);
    if (!intervals.length) continue;
    const interval = Math.max(1, Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length));
    const averageAmount = history.reduce((sum, event) => sum.plus(event.amount), new Decimal(0)).div(history.length);
    let next = parseDate(history.at(-1)!.date);
    // Skip cadence occurrences that have already passed the report date. This
    // keeps the projection strictly forward-looking when an account's latest
    // dividend is older than its latest valuation.
    while (next <= asOf) next = addDays(next, interval);
    while (true) {
      if (next > horizon) break;
      projected.push({ eventId: `projection-${instrumentId}-${formatDate(next)}`, date: formatDate(next), instrumentId, amount: decimalString(averageAmount) });
      next = addDays(next, interval);
    }
  }
  return projected;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
function formatDate(value: Date): string { return value.toISOString().slice(0, 10); }
function addDays(value: Date, days: number): Date { const result = new Date(value); result.setUTCDate(result.getUTCDate() + days); return result; }
function daysBetween(left: Date, right: Date): number { return Math.round((right.getTime() - left.getTime()) / 86400000); }
