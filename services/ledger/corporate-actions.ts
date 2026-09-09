import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { OpenLot } from '@/services/ledger/fifo';

export type CorporateAction = {
  instrumentId: string;
  type: 'split' | 'symbol_change';
  status: 'quarantined' | 'validated' | 'rejected';
  ratioNumerator?: DecimalString;
  ratioDenominator?: DecimalString;
  replacementInstrumentId?: string;
};

/** Applies only evidence-validated corporate actions. Unverified source data cannot mutate lots. */
export function applyValidatedCorporateAction(lots: OpenLot[], action: CorporateAction): OpenLot[] {
  if (action.status !== 'validated') throw new Error('Corporate action must be validated before it affects holdings.');
  if (action.type === 'split') {
    if (!action.ratioNumerator || !action.ratioDenominator) throw new Error('Validated split requires a ratio.');
    const numerator = new Decimal(action.ratioNumerator);
    const denominator = new Decimal(action.ratioDenominator);
    if (numerator.lte(0) || denominator.lte(0)) throw new Error('Split ratio must be positive.');
    return lots.map((lot) => lot.instrumentId !== action.instrumentId ? lot : {
      ...lot,
      quantity: decimalString(new Decimal(lot.quantity).times(numerator).div(denominator).toFixed()),
      remainingQuantity: decimalString(new Decimal(lot.remainingQuantity).times(numerator).div(denominator).toFixed()),
    });
  }
  const replacementInstrumentId = action.replacementInstrumentId;
  if (!replacementInstrumentId) throw new Error('Validated symbol change requires a replacement instrument.');
  return lots.map((lot) => lot.instrumentId === action.instrumentId ? { ...lot, instrumentId: replacementInstrumentId } : lot);
}
