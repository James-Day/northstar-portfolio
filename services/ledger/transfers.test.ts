import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { linkInternalTransfers } from '@/services/ledger/transfers';

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
});
