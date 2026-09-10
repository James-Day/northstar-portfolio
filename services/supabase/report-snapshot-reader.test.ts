import { describe, expect, it, vi } from 'vitest';
import { SupabaseReportSnapshotReader } from '@/services/supabase/report-snapshot-reader';

describe('Supabase report snapshot reader', () => {
  it('reads the latest account snapshot with the caller token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', account_id: '33333333-3333-4333-8333-333333333333', report_type: 'account_daily', as_of_date: '2026-07-06', import_state_revision: 'rev-1', price_revision_id: null, payload: { totalValue: '100' }, published_at: '2026-07-06T23:00:00Z' }])));
    const reader = new SupabaseReportSnapshotReader({ supabaseUrl: 'https://supabase.test', anonKey: 'public-key', fetcher: fetcher as typeof fetch });
    await expect(reader.getLatest('33333333-3333-4333-8333-333333333333', 'user-token')).resolves.toMatchObject({ asOfDate: '2026-07-06', payload: { totalValue: '100' } });
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe('Bearer user-token');
    expect(String(fetcher.mock.calls[0][0])).toContain('order=as_of_date.desc%2Cpublished_at.desc%2Cid.desc');
  });

  it('reads a consolidated snapshot through the caller-scoped RLS token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', account_id: null, report_type: 'consolidated_daily', as_of_date: '2026-07-06', import_state_revision: 'consolidated:rev-1', price_revision_id: null, payload: { totalValue: '200' }, published_at: '2026-07-06T23:00:00Z' }])));
    const reader = new SupabaseReportSnapshotReader({ supabaseUrl: 'https://supabase.test', anonKey: 'public-key', fetcher: fetcher as typeof fetch });
    await expect(reader.getLatestConsolidated('22222222-2222-4222-8222-222222222222', 'user-token')).resolves.toMatchObject({ accountId: null, reportType: 'consolidated_daily', payload: { totalValue: '200' } });
    expect(String(fetcher.mock.calls[0][0])).toContain('account_id=is.null');
    expect(String(fetcher.mock.calls[0][0])).toContain('report_type=eq.consolidated_daily');
    expect(String(fetcher.mock.calls[0][0])).toContain('user_id=eq.22222222-2222-4222-8222-222222222222');
  });
});
