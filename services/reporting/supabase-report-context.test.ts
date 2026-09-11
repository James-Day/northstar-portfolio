import { describe, expect, it, vi } from 'vitest';
import { createSupabaseReportContextLoader } from './supabase-report-context';
import { isoDate } from '@/lib/domain/types';

describe('createSupabaseReportContextLoader', () => {
  it('composes committed replay and validated market inputs for a queue job', async () => {
    const replay = { events: [], openingLots: [], activityCoveredThrough: isoDate('2026-01-02'), sourceEntryIds: ['entry-1'] };
    const loader = createSupabaseReportContextLoader({
      ledger: { get: vi.fn().mockResolvedValue(replay) },
      market: { listCloses: vi.fn().mockResolvedValue([]), listCorrections: vi.fn().mockResolvedValue([]), listValidatedCorporateActions: vi.fn().mockResolvedValue([]) },
      resolveRange: vi.fn().mockResolvedValue({ from: isoDate('2026-01-02'), through: isoDate('2026-01-05') }),
    });
    await expect(loader({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' })).resolves.toMatchObject({ userId: 'user-1', accountId: 'account-1', inputs: { importStateRevision: 'ledger:entry-1', valuation: { dates: [{ date: '2026-01-02', canChainFromPrevious: false }, { date: '2026-01-05', canChainFromPrevious: true }] } } });
  });

  it('returns missing when the replay repository cannot prove ownership', async () => {
    const loader = createSupabaseReportContextLoader({ ledger: { get: vi.fn().mockResolvedValue(undefined) }, market: { listCloses: vi.fn(), listCorrections: vi.fn(), listValidatedCorporateActions: vi.fn() }, resolveRange: vi.fn() });
    await expect(loader({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'price_updated' })).resolves.toBeUndefined();
  });
});
