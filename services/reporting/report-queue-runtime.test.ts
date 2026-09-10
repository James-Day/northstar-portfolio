import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import type { ReportRecomputeDependencies } from '@/services/reporting/report-queue-handler';
import { consumeReportQueueBatch } from './report-queue-runtime';

const inputs: PersistedReportInputs = {
  valuation: { dates: [{ date: isoDate('2026-01-02'), canChainFromPrevious: false }], events: [], openingLots: [], closes: [], corporateActions: [] },
  ledger: { cash: decimalString('0'), openLots: [], realizedGainLoss: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('0'), sales: [] },
  activityCoveredThrough: isoDate('2026-01-01'),
  pricesThrough: isoDate('2026-01-02'),
  importStateRevision: 'ledger:entry-1',
};

function context(): ReportRecomputeDependencies {
  return {
    load: vi.fn().mockResolvedValue({ userId: 'user-1', accountId: 'account-1', inputs, priceRevisionId: 'price-rev-1' }),
    isCurrent: vi.fn().mockResolvedValue(true),
    publisher: { publish: vi.fn().mockResolvedValue('snapshot-1') },
  };
}

function message(body: unknown) { return { body, ack: vi.fn(), retry: vi.fn() }; }

describe('report queue runtime adapter', () => {
  it('resolves dependencies once and publishes a report from a queue message', async () => {
    const dependencies = context();
    const resolve = vi.fn().mockResolvedValue(dependencies);
    const current = message({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' });
    const result = await consumeReportQueueBatch({ messages: [current] }, {}, {} as ExecutionContext, resolve);

    expect(result).toEqual({ acknowledged: 1, retried: 0, rejected: 0 });
    expect(resolve).toHaveBeenCalledOnce();
    expect(dependencies.publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'account-1', importStateRevision: 'ledger:entry-1' }));
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it('leaves publication failures retryable for durable queue delivery', async () => {
    const dependencies = context();
    dependencies.publisher.publish = vi.fn().mockRejectedValue(new Error('snapshot store unavailable'));
    const current = message({ kind: 'report.recompute', accountId: 'account-1', requestedBy: 'user-1', reason: 'import_undone' });
    const result = await consumeReportQueueBatch({ messages: [current] }, {}, {} as ExecutionContext, async () => dependencies);

    expect(result).toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(current.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(current.ack).not.toHaveBeenCalled();
  });
});
