import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type DailyClose, type InstrumentAlias } from '@/lib/domain/types';
import { valueLedgerHistory } from '@/services/calculations/valuation';
import { runHistoricalSeedJob, type HistoricalSeedJobRepository, type HistoricalSeedJobState } from '@/services/market-data/historical-seed';
import type { DoltHubDailyClose } from '@/services/market-data/dolthub';

const alias = (instrumentId: string, symbol: string, from: string, to: string | null = null): InstrumentAlias => ({ instrumentId: instrumentId as InstrumentAlias['instrumentId'], symbol, effectiveFrom: isoDate(from), effectiveTo: to ? isoDate(to) : null });
const close = (symbol: string, date: string, value: string): DoltHubDailyClose => ({ symbol, tradingDate: isoDate(date), close: decimalString(value), source: 'dolthub', sourceRevision: 'ignored' });

/** A database-shaped seed gate. It tracks page markers and price keys exactly
 * as the durable repositories do, so a replay cannot inflate counters. */
function durableMemory() {
  const state: HistoricalSeedJobState = { id: 'seed-1', source: 'dolthub', symbols: ['AAPL', 'FB', 'META', 'UNKNOWN'], from: isoDate('2024-01-01'), through: isoDate('2024-01-05'), pageLimit: 2, sourceRevision: null, cursor: null, status: 'running', pages: 0, acceptedRows: 0, quarantinedRows: 0, lastError: null };
  const pageMarkers = new Set<string>();
  const prices = new Map<string, DailyClose>();
  const quarantine: string[] = [];
  const jobs: HistoricalSeedJobRepository = {
    async getOrCreate() { return { ...state }; },
    async recordPage(input) {
      const marker = `${input.jobId}:${input.pageKey}`;
      if (pageMarkers.has(marker)) return;
      pageMarkers.add(marker);
      state.sourceRevision = input.sourceRevision; state.cursor = input.cursor; state.pages += 1; state.acceptedRows += input.upserted; state.quarantinedRows += input.quarantined.length;
      quarantine.push(...input.quarantined.map((item) => `${item.record.symbol}:${item.record.tradingDate}`));
    },
    async complete() { state.status = 'completed'; },
    async fail(_id, error) { state.status = 'failed'; state.lastError = error; },
  };
  const persistence = { async persistDoltHubPage(input: { sourceRevision: string; records: Array<{ instrumentId: string; tradingDate: string; close: string; source: 'dolthub'; sourceRevision: string }> }) { let upserted = 0; for (const row of input.records) { const key = `${row.instrumentId}:${row.tradingDate}:${input.sourceRevision}`; if (!prices.has(key)) { prices.set(key, { instrumentId: row.instrumentId as never, tradingDate: row.tradingDate as never, close: row.close as never, source: 'dolthub', sourceRevision: input.sourceRevision }); upserted += 1; } } return { revisionId: input.sourceRevision, upserted }; } };
  return { state, jobs, persistence, prices, quarantine, pageMarkers };
}

describe('historical seed acceptance gate', () => {
  it('is repeat-safe, revision-traceable, alias-aware, and excludes quarantine from valuation', async () => {
    const store = durableMemory();
    const pages = [
      { records: [close('AAPL', '2024-01-02', '100'), close('AAPL', '2024-01-03', '10')], sourceRevision: 'dolt-revision-1', nextCursor: { tradingDate: isoDate('2024-01-03'), symbol: 'AAPL' } },
      { records: [close('META', '2024-01-04', '105'), close('UNKNOWN', '2024-01-05', '50')], sourceRevision: 'dolt-revision-1', nextCursor: null },
    ];
    let calls = 0;
    const source = { getDailyClosePage: async ({ cursor }: { cursor?: { tradingDate: string; symbol: string } }) => { const page = pages[cursor ? 1 : 0] ?? { records: [], sourceRevision: 'dolt-revision-1', nextCursor: null }; calls += 1; return page; } };
    const aliases = [alias('apple', 'AAPL', '2020-01-01'), alias('meta', 'FB', '2012-01-01', '2022-06-08'), alias('meta', 'META', '2022-06-09')];
    const first = await runHistoricalSeedJob({ source, persistence: store.persistence, jobs: store.jobs, aliases, symbols: ['AAPL', 'FB', 'META', 'UNKNOWN'], from: isoDate('2024-01-01'), through: isoDate('2024-01-05'), pageLimit: 2 });
    expect(first).toMatchObject({ status: 'completed', sourceRevision: 'dolt-revision-1', upserted: 2, quarantined: 2 });
    expect(store.prices.get('apple:2024-01-02:dolt-revision-1')?.sourceRevision).toBe('dolt-revision-1');
    expect([...store.prices.keys()]).not.toContain('apple:2024-01-03:dolt-revision-1');
    expect(store.quarantine).toEqual(expect.arrayContaining(['AAPL:2024-01-03', 'UNKNOWN:2024-01-05']));
    const repeat = await runHistoricalSeedJob({ source, persistence: store.persistence, jobs: store.jobs, aliases, symbols: ['AAPL', 'FB', 'META', 'UNKNOWN'], from: isoDate('2024-01-01'), through: isoDate('2024-01-05'), pageLimit: 2 });
    expect(repeat).toMatchObject({ status: 'completed', upserted: 0 });
    expect(store.state.pages).toBe(2); expect(store.state.acceptedRows).toBe(2); expect(calls).toBe(2);
    const valuation = valueLedgerHistory({ dates: [{ date: isoDate('2024-01-03'), canChainFromPrevious: false }], events: [{ id: 'buy', date: isoDate('2024-01-02'), type: 'buy', instrumentId: 'apple', quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') }], closes: [...store.prices.values()] });
    expect(valuation.valuations[0]).toMatchObject({ totalValue: null, missingInstrumentIds: ['apple'] });
  });

  it('restarts from the durable cursor after a page failure without changing revision', async () => {
    const store = durableMemory(); let calls = 0; let fail = true;
    const source = { getDailyClosePage: async ({ cursor }: { cursor?: { tradingDate: string; symbol: string } }) => { if (!cursor) return { records: [close('AAPL', '2024-01-02', '100')], sourceRevision: 'dolt-revision-2', nextCursor: { tradingDate: isoDate('2024-01-02'), symbol: 'AAPL' } }; calls += 1; if (fail) { fail = false; throw new Error('temporary source outage'); } return { records: [close('AAPL', '2024-01-03', '101')], sourceRevision: 'dolt-revision-2', nextCursor: null }; } };
    const input = { source, persistence: store.persistence, jobs: store.jobs, aliases: [alias('apple', 'AAPL', '2020-01-01')], symbols: ['AAPL'], from: isoDate('2024-01-01'), through: isoDate('2024-01-03'), pageLimit: 2 };
    await expect(runHistoricalSeedJob(input)).rejects.toThrow('temporary source outage');
    expect(store.state.cursor).toEqual({ tradingDate: '2024-01-02', symbol: 'AAPL' });
    const result = await runHistoricalSeedJob(input);
    expect(result).toMatchObject({ status: 'completed', sourceRevision: 'dolt-revision-2', upserted: 1 });
    expect(store.state.acceptedRows).toBe(2); expect(store.state.pages).toBe(2); expect(calls).toBe(2);
  });
});
