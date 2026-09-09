import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';

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
