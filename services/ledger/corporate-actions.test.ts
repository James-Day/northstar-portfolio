import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { applyValidatedCorporateAction } from '@/services/ledger/corporate-actions';

const lot = { id: 'lot', instrumentId: 'nvda', acquiredOn: isoDate('2024-01-01'), quantity: decimalString('3'), remainingQuantity: decimalString('2'), totalCostBasis: decimalString('300') };

describe('corporate actions', () => {
  it('does not let quarantined source actions change a holding', () => {
    expect(() => applyValidatedCorporateAction([lot], { instrumentId: 'nvda', type: 'split', status: 'quarantined', ratioNumerator: decimalString('10'), ratioDenominator: decimalString('1') })).toThrow('must be validated');
  });

  it('adjusts quantities while retaining total basis for a validated split', () => {
    expect(applyValidatedCorporateAction([lot], { instrumentId: 'nvda', type: 'split', status: 'validated', ratioNumerator: decimalString('10'), ratioDenominator: decimalString('1') })[0]).toMatchObject({ quantity: '30', remainingQuantity: '20', totalCostBasis: '300' });
  });

  it('moves a lot to its validated replacement instrument', () => {
    expect(applyValidatedCorporateAction([lot], { instrumentId: 'nvda', type: 'symbol_change', status: 'validated', replacementInstrumentId: 'new-nvda' })[0].instrumentId).toBe('new-nvda');
  });
});
