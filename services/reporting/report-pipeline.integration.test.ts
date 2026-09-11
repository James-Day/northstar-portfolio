import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { composePersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { consumeReportQueueBatch } from '@/services/reporting/report-queue-runtime';
import type { ReportSnapshotInput } from '@/services/supabase/report-snapshots-repository';

const accountId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const instrumentId = '33333333-3333-4333-8333-333333333333';

function message(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('persisted import to report pipeline', () => {
  it('composes committed activity and stored prices before queue publication', async () => {
    const inputs = composePersistedReportInputs({
      replay: {
        events: [
          { id: 'deposit-1', date: isoDate('2026-01-01'), type: 'deposit', amount: decimalString('100') },
          { id: 'buy-1', date: isoDate('2026-01-01'), type: 'buy', instrumentId, quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') },
          { id: 'dividend-1', date: isoDate('2026-01-02'), type: 'dividend', instrumentId, amount: decimalString('2.50') },
        ],
        openingLots: [],
        activityCoveredThrough: isoDate('2026-01-02'),
        sourceEntryIds: ['entry-1', 'entry-2', 'entry-3'],
      },
      dates: [
        { date: isoDate('2026-01-01'), canChainFromPrevious: false },
        { date: isoDate('2026-01-02'), canChainFromPrevious: true },
      ],
      closes: [
        { instrumentId: instrumentId as never, tradingDate: isoDate('2026-01-01'), close: decimalString('100'), source: 'dolthub', sourceRevision: 'seed-1' },
        { instrumentId: instrumentId as never, tradingDate: isoDate('2026-01-02'), close: decimalString('105'), source: 'marketstack', sourceRevision: 'daily-1' },
      ],
    });
    const publisher = { publish: vi.fn().mockResolvedValue('snapshot-1') };
    const current = message({ kind: 'report.recompute', accountId, requestedBy: userId, reason: 'import_committed' });

    const result = await consumeReportQueueBatch(
      { messages: [current] },
      {},
      {} as ExecutionContext,
      async () => ({
        load: async () => ({ userId, accountId, inputs, priceRevisionId: null }),
        isCurrent: async () => true,
        publisher,
      }),
    );

    expect(result).toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(current.ack).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      importStateRevision: 'ledger:entry-1,entry-2,entry-3',
      payload: expect.objectContaining({
        totalValue: '107.5',
        dividendIncome: '2.5',
        dividends: [{ eventId: 'dividend-1', date: '2026-01-02', instrumentId, amount: '2.5' }],
      }),
    }));
  });

  it('recomputes undo and price corrections while preserving reproducible prior revisions', async () => {
    const dates = [
      { date: isoDate('2026-01-01'), canChainFromPrevious: false },
      { date: isoDate('2026-01-02'), canChainFromPrevious: true },
    ];
    const committedEvents = [
      { id: 'deposit-1', date: isoDate('2026-01-01'), type: 'deposit' as const, amount: decimalString('100') },
      { id: 'buy-1', date: isoDate('2026-01-01'), type: 'buy' as const, instrumentId, quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') },
    ];
    const sourceCloses = [
      { instrumentId: instrumentId as never, tradingDate: isoDate('2026-01-01'), close: decimalString('100'), source: 'dolthub' as const, sourceRevision: 'seed-1' },
      { instrumentId: instrumentId as never, tradingDate: isoDate('2026-01-02'), close: decimalString('105'), source: 'dolthub' as const, sourceRevision: 'seed-1' },
    ];
    const correction = {
      instrumentId: instrumentId as never,
      tradingDate: isoDate('2026-01-02'),
      correctedClose: decimalString('110'),
      evidence: 'issuer close correction ticket CORR-1',
      correctionVersion: 'correction-1',
    };
    const snapshots = new Map<string, ReportSnapshotInput & { id: string }>();
    const publisher = {
      publish: vi.fn(async (input: ReportSnapshotInput) => {
        const key = `${input.importStateRevision}|${input.priceRevisionId ?? 'none'}`;
        const existing = snapshots.get(key);
        if (existing) return existing.id;
        const record = { ...input, payload: structuredClone(input.payload), id: `snapshot-${snapshots.size + 1}` };
        snapshots.set(key, record);
        return record.id;
      }),
    };

    const compose = (events: typeof committedEvents, sourceEntryIds: string[], corrections: typeof correction[] = []) => composePersistedReportInputs({
      replay: { events, openingLots: [], activityCoveredThrough: events.at(-1)?.date ?? isoDate('2026-01-01'), sourceEntryIds },
      dates,
      closes: sourceCloses,
      corrections,
    });
    const run = async (reason: 'import_committed' | 'import_undone' | 'price_updated', inputs: ReturnType<typeof compose>, priceRevisionId = '44444444-4444-4444-8444-444444444444') => {
      const current = message({ kind: 'report.recompute', accountId, requestedBy: userId, reason });
      const result = await consumeReportQueueBatch(
        { messages: [current] }, {}, {} as ExecutionContext,
        async () => ({ load: async () => ({ userId, accountId, inputs, priceRevisionId }), isCurrent: async () => true, publisher }),
      );
      expect(result).toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    };

    const original = compose(committedEvents, ['entry-1', 'entry-2']);
    await run('import_committed', original);
    const originalKey = 'ledger:entry-1,entry-2|44444444-4444-4444-8444-444444444444';
    const originalSnapshot = structuredClone(snapshots.get(originalKey));
    const originalPayload = originalSnapshot?.payload as { totalValue?: unknown; priceDependencies?: Array<{ sourceRevision?: unknown; correctionVersion?: unknown }> };
    expect(originalPayload.totalValue).toBe('105');
    expect(originalPayload.priceDependencies).toContainEqual(expect.objectContaining({ sourceRevision: 'seed-1', correctionVersion: null }));

    await run('price_updated', compose(committedEvents, ['entry-1', 'entry-2'], [correction]), '55555555-5555-4555-8555-555555555555');
    const correctedSnapshot = [...snapshots.values()].find((snapshot) => {
      const dependencies = (snapshot.payload as { priceDependencies?: Array<{ correctionVersion?: unknown }> }).priceDependencies;
      return dependencies?.some((dependency) => dependency.correctionVersion === 'correction-1');
    });
    const correctedPayload = correctedSnapshot?.payload as { totalValue?: unknown; priceDependencies?: Array<{ sourceRevision?: unknown; correctionVersion?: unknown }> };
    expect(correctedPayload.totalValue).toBe('110');
    expect(correctedPayload.priceDependencies).toContainEqual(expect.objectContaining({ sourceRevision: 'seed-1', correctionVersion: 'correction-1' }));

    await run('import_undone', compose([], []));
    const undoneSnapshot = snapshots.get('ledger:empty|44444444-4444-4444-8444-444444444444');
    expect(undoneSnapshot?.payload).toMatchObject({ totalValue: '0', holdings: [] });
    expect(snapshots.get(originalKey)).toEqual(originalSnapshot);

    // Replaying the original immutable dependencies after newer revisions exist
    // produces the same report, proving old snapshots are independently reproducible.
    await run('import_committed', original);
    expect(snapshots.get(originalKey)).toEqual(originalSnapshot);
    expect(publisher.publish).toHaveBeenCalledTimes(4);
  });
});
