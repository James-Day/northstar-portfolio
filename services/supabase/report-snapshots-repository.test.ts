import { describe, expect, it, vi } from 'vitest';
import { SupabaseReportSnapshotsRepository } from '@/services/supabase/report-snapshots-repository';

describe('Supabase report snapshots repository', () => {
  it('publishes a versioned snapshot as one immutable insert', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]), { status: 201 }));
    const repository = new SupabaseReportSnapshotsRepository({ supabaseUrl: 'https://supabase.test', serviceRoleKey: 'service-secret', fetcher: fetcher as typeof fetch });
    await expect(repository.publish({ userId: '22222222-2222-4222-8222-222222222222', accountId: '33333333-3333-4333-8333-333333333333', reportType: 'account_daily', asOfDate: '2026-07-06', importStateRevision: 'import-rev-1', priceRevisionId: null, payload: { value: '100' } })).resolves.toBe('11111111-1111-4111-8111-111111111111');
    expect(String(fetcher.mock.calls[0][0])).toContain('on_conflict=publication_key');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ prefer: 'resolution=merge-duplicates,return=representation' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ user_id: '22222222-2222-4222-8222-222222222222', report_type: 'account_daily', as_of_date: '2026-07-06', import_state_revision: 'import-rev-1', payload: { value: '100' } });
  });
});
