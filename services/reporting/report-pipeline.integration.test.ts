import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { composePersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { consumeReportQueueBatch } from '@/services/reporting/report-queue-runtime';

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
});
