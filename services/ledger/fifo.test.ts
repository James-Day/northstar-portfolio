import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { applyFifoLedger } from '@/services/ledger/fifo';

const d = decimalString;
const date = isoDate('2026-01-02');

describe('applyFifoLedger', () => {
  it('matches fractional lots FIFO and applies the sale fee exactly once', () => {
    const result = applyFifoLedger([
      { id: 'buy-1', date, type: 'buy', instrumentId: 'aapl', quantity: d('1.5'), grossAmount: d('150'), fee: d('1') },
      { id: 'buy-2', date, type: 'buy', instrumentId: 'aapl', quantity: d('1'), grossAmount: d('120'), fee: d('0') },
      { id: 'sale-1', date, type: 'sell', instrumentId: 'aapl', quantity: d('2'), grossAmount: d('300'), fee: d('2') },
    ]);
    expect(result.sales[0]).toMatchObject({ proceeds: '298', matchedCostBasis: '211', gainLoss: '87', basisKnown: true });
    expect(result.openLots[0]).toMatchObject({ id: 'buy-2', remainingQuantity: '0.5' });
    expect(result.cash).toBe('27');
  });

  it('records dividend income once when a dividend is reinvested', () => {
    const result = applyFifoLedger([
      { id: 'dividend-1', date, type: 'dividend', amount: d('10') },
      { id: 'drip-1', date, type: 'drip_buy', instrumentId: 'vti', quantity: d('0.1'), grossAmount: d('10'), fee: d('0') },
    ]);
    expect(result.dividendIncome).toBe('10');
    expect(result.cash).toBe('0');
    expect(result.openLots[0]).toMatchObject({ totalCostBasis: '10', remainingQuantity: '0.1' });
  });

  it('does not invent realized gain or loss when a sold lot has unknown basis', () => {
    const result = applyFifoLedger([{ id: 'sale-1', date, type: 'sell', instrumentId: 'vti', quantity: d('1'), grossAmount: d('200'), fee: d('0') }], [
      { id: 'opening', instrumentId: 'vti', acquiredOn: null, quantity: d('1'), totalCostBasis: null },
    ]);
    expect(result.realizedGainLoss).toBeNull();
    expect(result.sales[0]).toMatchObject({ matchedCostBasis: null, gainLoss: null, basisKnown: false });
  });
});
