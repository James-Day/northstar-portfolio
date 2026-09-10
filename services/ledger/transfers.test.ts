import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { applyLinkedLotTransfers, linkInternalTransfers } from '@/services/ledger/transfers';

const d = decimalString;

describe('internal transfers', () => {
  it('links reconciled transfers across accounts for consolidated reporting', () => {
    const result = linkInternalTransfers([
      { id: 'out', transferGroupId: 'move', direction: 'out', accountId: 'taxable', instrumentId: null, quantity: null, cashAmount: d('-100') },
      { id: 'in', transferGroupId: 'move', direction: 'in', accountId: 'roth', instrumentId: null, quantity: null, cashAmount: d('100') },
    ]);
    expect(result).toEqual({ linked: [{ transferGroupId: 'move', incomingId: 'in', outgoingId: 'out' }], unresolved: [] });
  });

  it('flags unresolved transfers rather than assuming they offset', () => {
    const result = linkInternalTransfers([
      { id: 'out', transferGroupId: 'move', direction: 'out', accountId: 'taxable', instrumentId: null, quantity: null, cashAmount: d('-100') },
      { id: 'in', transferGroupId: 'move', direction: 'in', accountId: 'roth', instrumentId: null, quantity: null, cashAmount: d('90') },
    ]);
    expect(result.unresolved[0].reason).toContain('does not reconcile');
  });

  it('carries FIFO lots and proportional basis to the receiving account', () => {
    const transfers = [
      { id: 'out', transferGroupId: 'shares', direction: 'out' as const, accountId: 'taxable', instrumentId: 'VTI', quantity: d('1.5'), cashAmount: d('0') },
      { id: 'in', transferGroupId: 'shares', direction: 'in' as const, accountId: 'ira', instrumentId: 'VTI', quantity: d('1.5'), cashAmount: d('0') },
    ];
    const result = applyLinkedLotTransfers([
      { id: 'lot-1', accountId: 'taxable', instrumentId: 'VTI', acquiredOn: '2024-01-01', quantity: d('1'), remainingQuantity: d('1'), totalCostBasis: d('100') },
      { id: 'lot-2', accountId: 'taxable', instrumentId: 'VTI', acquiredOn: '2024-02-01', quantity: d('2'), remainingQuantity: d('2'), totalCostBasis: d('240') },
    ], transfers, [{ transferGroupId: 'shares', incomingId: 'in', outgoingId: 'out' }]);
    expect(result.unresolved).toEqual([]);
    expect(result.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'in:lot-1', accountId: 'ira', quantity: '1', totalCostBasis: '100' }),
      expect.objectContaining({ id: 'in:lot-2', accountId: 'ira', quantity: '0.5', totalCostBasis: '60' }),
    ]));
    expect(result.lots).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'lot-1' })]));
  });

  it('leaves lots unchanged when a transfer exceeds available shares', () => {
    const transfers = [
      { id: 'out', transferGroupId: 'shares', direction: 'out' as const, accountId: 'taxable', instrumentId: 'VTI', quantity: d('2'), cashAmount: d('0') },
      { id: 'in', transferGroupId: 'shares', direction: 'in' as const, accountId: 'ira', instrumentId: 'VTI', quantity: d('2'), cashAmount: d('0') },
    ];
    const result = applyLinkedLotTransfers([{ id: 'lot-1', accountId: 'taxable', instrumentId: 'VTI', acquiredOn: '2024-01-01', quantity: d('1'), remainingQuantity: d('1'), totalCostBasis: d('100') }], transfers, [{ transferGroupId: 'shares', incomingId: 'in', outgoingId: 'out' }]);
    expect(result.unresolved[0].reason).toContain('exceeds available lots');
    expect(result.lots).toEqual([expect.objectContaining({ id: 'lot-1', remainingQuantity: '1' })]);
  });
});
