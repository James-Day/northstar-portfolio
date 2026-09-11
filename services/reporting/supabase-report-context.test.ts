import { describe, expect, it, vi } from 'vitest';
import { createSupabaseReportContextLoader } from './supabase-report-context';
import { isoDate } from '@/lib/domain/types';

describe('createSupabaseReportContextLoader', () => {
  it('composes committed replay and validated market inputs for a queue job', async () => {
    const replay = { events: [], openingLots: [], activityCoveredThrough: isoDate('2026-01-02'), sourceEntryIds: ['entry-1'] };
    const loader = createSupabaseReportContextLoader({
      ledger: { get: vi.fn().mockResolvedValue(replay) },
      market: { listCloses: vi.fn().mockResolvedValue([]), listCorrections: vi.fn().mockResolvedValue([]), listValidatedCorporateActions: vi.fn().mockResolvedValue([]), findPriceRevisionId: vi.fn().mockResolvedValue(null) },
      resolveRange: vi.fn().mockResolvedValue({ from: isoDate('2026-01-02'), through: isoDate('2026-01-05') }),
    });
    await expect(loader({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' })).resolves.toMatchObject({ userId: 'user-1', accountId: 'account-1', inputs: { importStateRevision: 'ledger:entry-1', valuation: { dates: [{ date: '2026-01-02', canChainFromPrevious: false }, { date: '2026-01-05', canChainFromPrevious: true }] } } });
  });

  it('returns missing when the replay repository cannot prove ownership', async () => {
    const loader = createSupabaseReportContextLoader({ ledger: { get: vi.fn().mockResolvedValue(undefined) }, market: { listCloses: vi.fn(), listCorrections: vi.fn(), listValidatedCorporateActions: vi.fn(), findPriceRevisionId: vi.fn() }, resolveRange: vi.fn() });
    await expect(loader({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'price_updated' })).resolves.toBeUndefined();
  });

  it('attaches a UUID only for one unambiguous provider revision', async () => {
    const replay = { events: [], openingLots: [{ id: 'lot-1', instrumentId: '11111111-1111-4111-8111-111111111111', acquiredOn: isoDate('2026-01-02'), quantity: '1', totalCostBasis: '100' }], activityCoveredThrough: isoDate('2026-01-02'), sourceEntryIds: ['entry-1'] };
    const findPriceRevisionId = vi.fn().mockResolvedValue('22222222-2222-4222-8222-222222222222');
    const loader = createSupabaseReportContextLoader({ ledger: { get: vi.fn().mockResolvedValue(replay) }, market: { listCloses: vi.fn().mockResolvedValue([{ instrumentId: replay.openingLots[0].instrumentId, tradingDate: isoDate('2026-01-02'), close: '101', source: 'dolthub', sourceRevision: 'commit-1' }]), listCorrections: vi.fn().mockResolvedValue([]), listValidatedCorporateActions: vi.fn().mockResolvedValue([]), findPriceRevisionId }, resolveRange: vi.fn().mockResolvedValue({ from: isoDate('2026-01-02'), through: isoDate('2026-01-02') }) });
    await expect(loader({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'price_updated' })).resolves.toMatchObject({ priceRevisionId: '22222222-2222-4222-8222-222222222222' });
    expect(findPriceRevisionId).toHaveBeenCalledWith({ source: 'dolthub', sourceRevision: 'commit-1' });
  });
});
