import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type InstrumentAlias } from '@/lib/domain/types';
import { runHistoricalSeedJob, type HistoricalSeedJobRepository, type HistoricalSeedJobState } from '@/services/market-data/historical-seed';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';
import type { HistoricalPageSource } from '@/services/market-data/historical-ingestion';

const alias = (symbol: string, instrumentId: string): InstrumentAlias => ({ symbol, instrumentId: instrumentId as never, effectiveFrom: isoDate('2020-01-01'), effectiveTo: null });
const close = (symbol: string, date: string, value: string): DoltHubDailyClose => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub', sourceRevision: 'ignored' });
function memory(): HistoricalSeedJobRepository & { state: HistoricalSeedJobState; quarantine: unknown[] } {
  const state: HistoricalSeedJobState = { id: 'job-1', source: 'dolthub', symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 2, sourceRevision: null, cursor: null, status: 'running', pages: 0, acceptedRows: 0, quarantinedRows: 0, lastError: null };
  const quarantine: unknown[] = [];
  return {
    state, quarantine,
    async getOrCreate() { return { ...state }; },
    async recordPage(input) { state.sourceRevision = input.sourceRevision; state.cursor = input.cursor; state.pages += 1; state.acceptedRows += input.upserted; state.quarantinedRows += input.quarantined.length; quarantine.push(...input.quarantined); },
    async complete() { state.status = 'completed'; },
    async fail(_id, error) { state.status = 'failed'; state.lastError = error; },
  };
}

describe('runHistoricalSeedJob', () => {
  it('persists each page before advancing the durable cursor and finishes', async () => {
    const jobs = memory();
    const pages = [[close('AAPL', '2024-01-02', '100')], [close('AAPL', '2024-01-03', '101')]];
    const getDailyClosePage = vi.fn<HistoricalPageSource['getDailyClosePage']>().mockImplementation(async ({ cursor }) => ({ records: pages[cursor ? 1 : 0] ?? [], sourceRevision: 'rev-1', nextCursor: cursor ? null : { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' } }));
    const result = await runHistoricalSeedJob({ source: { getDailyClosePage }, persistence: { persistDoltHubPage: async ({ records }) => ({ revisionId: 'r', upserted: records.length }) }, jobs, aliases: [alias('AAPL', 'instrument-a')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 2 });
    expect(result).toMatchObject({ status: 'completed', sourceRevision: 'rev-1', pages: 2, upserted: 2 });
    expect(jobs.state.cursor).toBeNull();
    expect(getDailyClosePage.mock.calls[1][0].cursor).toEqual({ tradingDate: '2024-01-02', symbol: 'AAPL' });
  });

  it('records failure after a persisted page and resumes from the saved cursor', async () => {
    const jobs = memory();
    let attempts = 0;
    const getDailyClosePage = vi.fn<HistoricalPageSource['getDailyClosePage']>().mockImplementation(async ({ cursor }) => {
      attempts += 1;
      if (attempts === 2) throw new Error('temporary outage');
      return { records: [close('AAPL', '2024-01-02', '100')], sourceRevision: 'rev-1', nextCursor: { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' } };
    });
    const source = { getDailyClosePage };
    await expect(runHistoricalSeedJob({ source, persistence: { persistDoltHubPage: async ({ records }) => ({ revisionId: 'r', upserted: records.length }) }, jobs, aliases: [alias('AAPL', 'instrument-a')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 2 })).rejects.toThrow('temporary outage');
    expect(jobs.state.status).toBe('failed');
    source.getDailyClosePage.mockImplementationOnce(async () => ({ records: [close('AAPL', '2024-01-03', '101')], sourceRevision: 'rev-1', nextCursor: null }));
    const result = await runHistoricalSeedJob({ source, persistence: { persistDoltHubPage: async ({ records }) => ({ revisionId: 'r', upserted: records.length }) }, jobs, aliases: [alias('AAPL', 'instrument-a')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 2 });
    expect(result.status).toBe('completed');
    expect(source.getDailyClosePage.mock.calls.at(-1)?.[0].cursor).toEqual({ tradingDate: '2024-01-02', symbol: 'AAPL' });
  });

  it('stores alias failures for operator review and never publishes them', async () => {
    const jobs = memory();
    const result = await runHistoricalSeedJob({ source: { getDailyClosePage: async () => ({ records: [close('UNKNOWN', '2024-01-02', '10')], sourceRevision: 'rev-1', nextCursor: null }) }, persistence: { persistDoltHubPage: async ({ records }) => ({ revisionId: 'r', upserted: records.length }) }, jobs, aliases: [], symbols: ['UNKNOWN'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03') });
    expect(result).toMatchObject({ status: 'completed', upserted: 0, quarantined: 1 });
    expect(jobs.quarantine).toHaveLength(1);
    expect((jobs.quarantine[0] as { status: string }).status).toBe('pending');
  });

  it('rejects a changed source revision while resuming', async () => {
    const jobs = memory(); jobs.state.sourceRevision = 'old-rev'; jobs.state.cursor = { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' }; jobs.state.status = 'failed';
    await expect(runHistoricalSeedJob({ source: { getDailyClosePage: async () => ({ records: [], sourceRevision: 'new-rev', nextCursor: null }) }, persistence: { persistDoltHubPage: async () => ({ revisionId: 'r', upserted: 0 }) }, jobs, aliases: [alias('AAPL', 'instrument-a')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03') })).rejects.toThrow('source revision changed');
    expect(jobs.state.status).toBe('failed');
  });

  it('fails and leaves the seed incomplete when the source revision changes between pages', async () => {
    const jobs = memory();
    let page = 0;
    const source = {
      getDailyClosePage: vi.fn<HistoricalPageSource['getDailyClosePage']>().mockImplementation(async ({ cursor }) => {
        page += 1;
        return {
          records: [close('AAPL', cursor ? '2024-01-03' : '2024-01-02', cursor ? '101' : '100')],
          sourceRevision: cursor ? 'rev-2' : 'rev-1',
          nextCursor: cursor ? null : { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' },
        };
      }),
    };
    await expect(runHistoricalSeedJob({ source, persistence: { persistDoltHubPage: async ({ records }) => ({ revisionId: 'r', upserted: records.length }) }, jobs, aliases: [alias('AAPL', 'instrument-a')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 1 })).rejects.toThrow('source revision changed');
    expect(page).toBe(2);
    expect(jobs.state.status).toBe('failed');
    expect(jobs.state.cursor).toEqual({ tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' });
    expect(jobs.state.lastError).toContain('source revision changed');
  });
});
