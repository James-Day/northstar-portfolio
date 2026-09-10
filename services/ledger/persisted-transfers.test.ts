import { describe, expect, it } from 'vitest';
import { reconcilePersistedTransfers } from '@/services/ledger/persisted-transfers';

const row = (overrides: Partial<Parameters<typeof reconcilePersistedTransfers>[0][number]> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', effectiveDate: '2024-01-01', entryType: 'transfer_out' as const, transferGroupId: '33333333-3333-4333-8333-333333333333', instrumentId: null, symbol: null, quantity: null, cashAmount: '-100', ...overrides,
});

describe('persisted transfer reconciliation', () => {
  it('reconciles durable cash rows across accounts', () => {
    const result = reconcilePersistedTransfers([
      row(),
      row({ id: '44444444-4444-4444-8444-444444444444', accountId: '55555555-5555-4555-8555-555555555555', entryType: 'transfer_in', cashAmount: '100' }),
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.linked).toHaveLength(1);
  });

  it('resolves an effective ticker alias before matching share transfers', () => {
    const result = reconcilePersistedTransfers([
      row({ symbol: 'FB', quantity: '2', cashAmount: '0' }),
      row({ id: '44444444-4444-4444-8444-444444444444', accountId: '55555555-5555-4555-8555-555555555555', entryType: 'transfer_in', symbol: 'FB', quantity: '2', cashAmount: '0' }),
    ], [{ instrumentId: '66666666-6666-4666-8666-666666666666' as never, symbol: 'FB', effectiveFrom: '2012-01-01' as never, effectiveTo: null }]);
    expect(result.transfers.every((transfer) => transfer.instrumentId === '66666666-6666-4666-8666-666666666666')).toBe(true);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps an ungrouped transfer explicit', () => {
    const result = reconcilePersistedTransfers([row({ transferGroupId: null })]);
    expect(result.linked).toEqual([]);
    expect(result.unresolved[0]).toMatchObject({ ids: ['11111111-1111-4111-8111-111111111111'] });
  });

  it('keeps an unknown ticker explicit instead of assigning a new instrument', () => {
    const result = reconcilePersistedTransfers([row({ symbol: 'UNKNOWN', quantity: '1', cashAmount: '0' })]);
    expect(result.transfers).toEqual([]);
    expect(result.unresolved[0].reason).toContain('No effective instrument alias');
  });
});
