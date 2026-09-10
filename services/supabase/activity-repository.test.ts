import { describe, expect, it, vi } from 'vitest';
import { SupabaseActivityRepository } from './activity-repository';

describe('SupabaseActivityRepository', () => {
  it('requests one extra row for hasMore and preserves source-row detail', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222', effective_date: '2026-01-02', entry_type: 'buy', instrument_id: '33333333-3333-4333-8333-333333333333', quantity: '2.5', unit_price: '10', cash_amount: '-25', external_flow: false, description: 'Buy', source_row_id: '44444444-4444-4444-8444-444444444444', source_row: { row_number: 9, raw_row: { Activity: 'Buy' }, parse_status: 'supported', message: null } },
      { id: '55555555-5555-4555-8555-555555555555', account_id: '22222222-2222-4222-8222-222222222222', effective_date: '2026-01-01', entry_type: 'deposit', instrument_id: null, quantity: null, unit_price: null, cash_amount: '25', external_flow: true, description: 'Deposit', source_row_id: null, source_row: null },
    ]), { status: 200 }));
    const page = await new SupabaseActivityRepository({ supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', fetcher }).list('22222222-2222-4222-8222-222222222222', 'token', { limit: 1 });
    expect(page.hasMore).toBe(true);
    expect(page.items[0].sourceRow?.rowNumber).toBe(9);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('limit')).toBe('2');
  });

  it('rejects unsafe pagination values', async () => {
    const repository = new SupabaseActivityRepository({ supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', fetcher: vi.fn() });
    await expect(repository.list('22222222-2222-4222-8222-222222222222', 'token', { limit: 101 })).rejects.toThrow('limit');
  });
});
