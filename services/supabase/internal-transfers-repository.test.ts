import { describe, expect, it, vi } from 'vitest';
import { SupabaseInternalTransfersRepository } from '@/services/supabase/internal-transfers-repository';

const accountId = '11111111-1111-4111-8111-111111111111';
const incomingId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';

describe('SupabaseInternalTransfersRepository', () => {
  it('loads owned transfers and persists linked reconciliation records', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: accountId }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: incomingId, account_id: accountId, effective_date: '2024-01-01', entry_type: 'transfer_in', internal_transfer_group: groupId, instrument_id: null, quantity: null, cash_amount: '100' },
        { id: '44444444-4444-4444-8444-444444444444', account_id: '66666666-6666-4666-8666-666666666666', effective_date: '2024-01-01', entry_type: 'transfer_out', internal_transfer_group: groupId, instrument_id: null, quantity: null, cash_amount: '-100' },
      ])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const result = await new SupabaseInternalTransfersRepository({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon', fetcher }).reconcile('55555555-5555-4555-8555-555555555555', 'token');
    expect(result.unresolved).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual([expect.objectContaining({ transfer_group_id: groupId, status: 'linked', incoming_entry_id: incomingId })]);
  });
});
