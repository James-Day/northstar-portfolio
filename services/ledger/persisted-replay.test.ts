import { describe, expect, it, vi } from 'vitest';
import { SupabaseLedgerReplayRepository } from '@/services/ledger/persisted-replay';

const accountId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const instrumentId = '33333333-3333-4333-8333-333333333333';
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444444', account_id: accountId, effective_date: '2026-01-02', entry_type: 'buy', instrument_id: instrumentId,
  quantity: '1.25', unit_price: '80', cash_amount: '-100', description: 'Buy', imports: { status: 'committed' }, ...overrides,
});

describe('SupabaseLedgerReplayRepository', () => {
  it('loads only committed entries in stable order and maps signed storage values to FIFO inputs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: accountId, user_id: userId }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        entry({ id: '44444444-4444-4444-8444-444444444445', effective_date: '2026-01-01', entry_type: 'opening_position', quantity: '2.5', unit_price: '40', cash_amount: '0' }),
        entry({ id: '44444444-4444-4444-8444-444444444446', entry_type: 'buy' }),
        entry({ id: '44444444-4444-4444-8444-444444444447', entry_type: 'dividend', instrument_id: null, quantity: null, unit_price: null, cash_amount: '4.25' }),
        entry({ id: '44444444-4444-4444-8444-444444444448', entry_type: 'transfer_out', instrument_id: null, quantity: null, unit_price: null, cash_amount: '-2' }),
      ])));
    const repository = new SupabaseLedgerReplayRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });

    await expect(repository.get(accountId, userId)).resolves.toEqual({
      events: [
        { id: '44444444-4444-4444-8444-444444444446', date: '2026-01-02', type: 'buy', instrumentId, quantity: '1.25', grossAmount: '100', fee: '0' },
        { id: '44444444-4444-4444-8444-444444444447', date: '2026-01-02', type: 'dividend', amount: '4.25' },
        { id: '44444444-4444-4444-8444-444444444448', date: '2026-01-02', type: 'transfer_out', amount: '2' },
      ],
      openingLots: [{ id: '44444444-4444-4444-8444-444444444445', instrumentId, acquiredOn: '2026-01-01', quantity: '2.5', totalCostBasis: '100' }],
      activityCoveredThrough: '2026-01-02',
      sourceEntryIds: [
        '44444444-4444-4444-8444-444444444445', '44444444-4444-4444-8444-444444444446',
        '44444444-4444-4444-8444-444444444447', '44444444-4444-4444-8444-444444444448',
      ],
    });
    const ledgerUrl = fetcher.mock.calls[1][0] as URL;
    expect(ledgerUrl.searchParams.get('imports.status')).toBe('eq.committed');
    expect(ledgerUrl.searchParams.get('order')).toBe('effective_date.asc,id.asc');
  });

  it('does not read ledger rows when the account belongs to another user', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: accountId, user_id: '99999999-9999-4999-8999-999999999999' }])));
    const repository = new SupabaseLedgerReplayRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.get(accountId, userId)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
