import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';
import { isoDate } from '@/lib/domain/types';

export type AccountType = 'individual' | 'traditional_ira' | 'roth_ira';

export type OpeningPosition = {
  instrumentId: string;
  quantity: DecimalString;
  acquiredOn: IsoDate | null;
  totalCostBasis: DecimalString | null;
};

export type OpeningHistory = {
  openingCash: DecimalString;
  positions: OpeningPosition[];
  activityCoveredFrom: IsoDate | null;
  incompleteReason: string | null;
};

/** Parse the JSON contract used by the account opening-history endpoint. */
export function parseOpeningHistory(input: unknown): OpeningHistory {
  if (!input || typeof input !== 'object') throw new Error('Opening history must be an object.');
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.positions)) throw new Error('Opening history positions must be an array.');
  const positions = value.positions.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Opening position ${index + 1} must be an object.`);
    const position = raw as Record<string, unknown>;
    if (typeof position.instrumentId !== 'string' || !position.instrumentId.trim()) throw new Error(`Opening position ${index + 1} requires an instrument.`);
    const acquiredOn = position.acquiredOn === null || position.acquiredOn === undefined ? null : isoDate(String(position.acquiredOn));
    const totalCostBasis = position.totalCostBasis === null || position.totalCostBasis === undefined ? null : decimalString(String(position.totalCostBasis));
    return { instrumentId: position.instrumentId.trim(), quantity: decimalString(String(position.quantity ?? '')), acquiredOn, totalCostBasis };
  });
  const activityCoveredFrom = value.activityCoveredFrom === null || value.activityCoveredFrom === undefined ? null : isoDate(String(value.activityCoveredFrom));
  const history = {
    openingCash: decimalString(String(value.openingCash ?? '')),
    positions,
    activityCoveredFrom,
    incompleteReason: value.incompleteReason === null || value.incompleteReason === undefined ? null : String(value.incompleteReason),
  } satisfies OpeningHistory;
  return validateOpeningHistory(history);
}

export function validateOpeningHistory(history: OpeningHistory): OpeningHistory {
  if (!history.incompleteReason && (history.activityCoveredFrom === null || history.positions.some((position) => position.totalCostBasis === null || position.acquiredOn === null))) {
    throw new Error('Incomplete opening history requires an explicit explanation.');
  }
  if (history.incompleteReason && !history.incompleteReason.trim()) throw new Error('Incomplete-history explanation cannot be blank.');
  for (const position of history.positions) {
    if (!position.instrumentId) throw new Error('Opening position requires an instrument.');
    const quantity = decimalString(position.quantity);
    if (quantity === '0' || quantity.startsWith('-')) throw new Error('Opening position quantity must be greater than zero.');
    if (position.totalCostBasis !== null && decimalString(position.totalCostBasis).startsWith('-')) throw new Error('Opening cost basis cannot be negative.');
  }
  return history;
}

export function accountTypeLabel(accountType: AccountType): string {
  return { individual: 'Individual brokerage', traditional_ira: 'Traditional IRA', roth_ira: 'Roth IRA' }[accountType];
}
