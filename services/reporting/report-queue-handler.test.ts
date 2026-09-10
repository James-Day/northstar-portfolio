import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { consumeQueueMessages } from '@/services/queues/consumer';
import { createReportRecomputeHandler, recomputeReport, type ReportRecomputeContext } from './report-queue-handler';

const job = { kind: 'report.recompute' as const, accountId: 'account-1', requestedBy: 'user-1', reason: 'import_committed' as const };
const inputs: PersistedReportInputs = {
  valuation: { dates: [{ date: isoDate('2026-01-02'), canChainFromPrevious: false }], events: [], openingLots: [], closes: [], corporateActions: [] },
  ledger: { cash: decimalString('0'), openLots: [], realizedGainLoss: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('0'), sales: [] },
  activityCoveredThrough: isoDate('2026-01-01'),
  pricesThrough: isoDate('2026-01-02'),
  importStateRevision: 'ledger:entry-1',
};
const context: ReportRecomputeContext = { userId: 'user-1', accountId: 'account-1', inputs, priceRevisionId: 'price-rev-1' };

function dependencies(overrides: Partial<Parameters<typeof recomputeReport>[1]> = {}) {
  return {
    load: vi.fn().mockResolvedValue(context),
    isCurrent: vi.fn().mockResolvedValue(true),
    publisher: { publish: vi.fn().mockResolvedValue('snapshot-1') },
    ...overrides,
  };
}

function message(body: unknown) { return { body, ack: vi.fn(), retry: vi.fn() }; }

describe('report queue handler', () => {
  it('loads composed inputs, calculates, and publishes one revision', async () => {
    const current = dependencies();
    await expect(recomputeReport(job, current)).resolves.toEqual({ status: 'published', snapshotId: 'snapshot-1' });
    expect(current.load).toHaveBeenCalledWith(job);
    expect(current.publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', accountId: 'account-1', importStateRevision: 'ledger:entry-1', priceRevisionId: 'price-rev-1', asOfDate: '2026-01-02' }));
  });

  it('skips missing or stale work without publishing', async () => {
    const missing = dependencies({ load: vi.fn().mockResolvedValue(undefined) });
    await expect(recomputeReport(job, missing)).resolves.toEqual({ status: 'missing' });
    expect(missing.publisher.publish).not.toHaveBeenCalled();

    const stale = dependencies({ isCurrent: vi.fn().mockResolvedValue(false) });
    await expect(recomputeReport(job, stale)).resolves.toEqual({ status: 'stale' });
    expect(stale.publisher.publish).not.toHaveBeenCalled();
  });

  it('rechecks freshness after calculating before publication', async () => {
    const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const current = dependencies({ isCurrent });
    await expect(recomputeReport(job, current)).resolves.toEqual({ status: 'stale' });
    expect(isCurrent).toHaveBeenCalledTimes(2);
    expect(current.publisher.publish).not.toHaveBeenCalled();
  });

  it('lets publisher failures escape so the queue retries the job', async () => {
    const current = dependencies({ publisher: { publish: vi.fn().mockRejectedValue(new Error('database unavailable')) } });
    const currentMessage = message(job);
    await expect(consumeQueueMessages([currentMessage], { reportRecompute: createReportRecomputeHandler(current) })).resolves.toEqual({ acknowledged: 0, retried: 1, rejected: 0 });
    expect(currentMessage.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(currentMessage.ack).not.toHaveBeenCalled();
  });

  it('passes the same revision on retry so repository publication stays idempotent', async () => {
    const current = dependencies();
    const handler = createReportRecomputeHandler(current);
    await handler(job);
    await handler(job);
    const publish = current.publisher.publish as ReturnType<typeof vi.fn>;
    const calls = publish.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ importStateRevision: 'ledger:entry-1', priceRevisionId: 'price-rev-1', asOfDate: '2026-01-02' });
    expect(calls[1][0]).toEqual(calls[0][0]);
  });
});
