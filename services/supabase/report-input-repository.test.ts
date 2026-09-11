import { describe, expect, it, vi } from 'vitest';
import { SupabaseReportInputRepository } from './report-input-repository';
import { isoDate } from '@/lib/domain/types';

describe('SupabaseReportInputRepository', () => {
  it('reads scoped closes with source revision provenance', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ instrument_id: '11111111-1111-4111-8111-111111111111', trading_date: '2026-01-02', close: '101.25', price_revisions: { source: 'dolthub', source_revision: 'commit-1' } }]), { status: 200 }));
    const repo = new SupabaseReportInputRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher });
    await expect(repo.listCloses({ instrumentIds: ['11111111-1111-4111-8111-111111111111' as never], from: isoDate('2026-01-01'), through: isoDate('2026-01-03') })).resolves.toMatchObject([{ close: '101.25', sourceRevision: 'commit-1' }]);
    expect(String(fetcher.mock.calls[0][0])).toContain('trading_date=gte.2026-01-01');
    expect(String(fetcher.mock.calls[0][0])).toContain('trading_date=lte.2026-01-03');
  });

  it('excludes unvalidated action rows at the query boundary', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ instrument_id: '11111111-1111-4111-8111-111111111111', action_date: '2026-01-02', action_type: 'split', ratio_numerator: '2', ratio_denominator: '1', status: 'validated' }]), { status: 200 }));
    const repo = new SupabaseReportInputRepository({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', fetcher });
    await expect(repo.listValidatedCorporateActions({ instrumentIds: ['11111111-1111-4111-8111-111111111111' as never], from: isoDate('2026-01-01'), through: isoDate('2026-01-03') })).resolves.toMatchObject([{ type: 'split', status: 'validated', ratioNumerator: '2' }]);
    expect(String(fetcher.mock.calls[0][0])).toContain('status=eq.validated');
  });
});
