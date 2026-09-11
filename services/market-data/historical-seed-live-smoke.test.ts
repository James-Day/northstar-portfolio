import { describe, expect, it } from 'vitest';
import { isoDate, type InstrumentAlias } from '@/lib/domain/types';
import { DoltHubHistoricalSource } from '@/services/market-data/dolthub';
import { runHistoricalSeedJob } from '@/services/market-data/historical-seed';
import { SupabaseHistoricalPricesRepository } from '@/services/supabase/historical-prices-repository';
import { SupabaseHistoricalSeedRepository } from '@/services/supabase/historical-seed-repository';

const enabled = process.env.DOLTHUB_LIVE_SMOKE === '1';
const symbol = (process.env.DOLTHUB_LIVE_SYMBOL ?? 'AAPL').trim().toUpperCase();
const from = isoDate(process.env.DOLTHUB_LIVE_FROM ?? '2024-01-02');
const through = isoDate(process.env.DOLTHUB_LIVE_THROUGH ?? '2024-01-02');

/**
 * Opt-in, one-page upstream smoke. Normal test runs never depend on the
 * public service. Set DOLTHUB_LIVE_PERSIST=1 with local Supabase credentials
 * to exercise the real durable seed and price repositories as well.
 */
describe.skipIf(!enabled)('live DoltHub historical seed smoke', () => {
  it('reads one bounded page with stable revision and provenance', async () => {
    const source = new DoltHubHistoricalSource();
    const page = await source.getDailyClosePage({ symbols: [symbol], from, through, limit: 1 });

    // Dolt commit refs are opaque strings; current public refs can include a
    // non-hex prefix, so provenance validation checks shape rather than a git
    // hash format.
    expect(page.sourceRevision).toMatch(/^[A-Za-z0-9_-]{7,128}$/);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({ symbol, tradingDate: from, source: 'dolthub', sourceRevision: page.sourceRevision });
    expect(Number(page.records[0]?.close)).toBeGreaterThan(0);
    expect(page.records[0]?.close).not.toBe('');
    console.log(`DoltHub smoke verified ${symbol} ${from}; source revision ${page.sourceRevision}.`);

    if (process.env.DOLTHUB_LIVE_PERSIST !== '1') return;
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceRoleKey) throw new Error('DOLTHUB_LIVE_PERSIST=1 requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');

    const aliases = await loadAliases(supabaseUrl, serviceRoleKey, symbol);
    if (!aliases.length) throw new Error(`No effective local instrument alias exists for ${symbol}.`);
    const jobs = new SupabaseHistoricalSeedRepository({ supabaseUrl, serviceRoleKey });
    const prices = new SupabaseHistoricalPricesRepository({ supabaseUrl, serviceRoleKey });
    const first = await runHistoricalSeedJob({ source, persistence: prices, jobs, aliases, symbols: [symbol], from, through, pageLimit: 1 });
    const repeat = await runHistoricalSeedJob({ source, persistence: prices, jobs, aliases, symbols: [symbol], from, through, pageLimit: 1 });
    expect(first.status).toBe('completed');
    expect(first.sourceRevision).toBe(page.sourceRevision);
    expect(first.pages).toBeGreaterThanOrEqual(1);
    expect(repeat.status).toBe('completed');
    expect(repeat.upserted).toBe(0);
    console.log(`Local Supabase seed persisted ${first.upserted} price row(s); repeat was idempotent.`);
  }, 30_000);
});

async function loadAliases(supabaseUrl: string, serviceRoleKey: string, symbol: string): Promise<InstrumentAlias[]> {
  const url = new URL('/rest/v1/instrument_aliases', supabaseUrl);
  url.searchParams.set('symbol', `eq.${encodeURIComponent(symbol)}`);
  url.searchParams.set('select', 'instrument_id,symbol,effective_from,effective_to');
  const response = await fetch(url, { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } });
  if (!response.ok) throw new Error(`Local instrument alias lookup failed with HTTP ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Local instrument alias lookup returned an invalid response.');
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    if (typeof value.instrument_id !== 'string' || typeof value.symbol !== 'string' || typeof value.effective_from !== 'string') return [];
    return [{ instrumentId: value.instrument_id as InstrumentAlias['instrumentId'], symbol: value.symbol, effectiveFrom: isoDate(value.effective_from), effectiveTo: value.effective_to === null ? null : typeof value.effective_to === 'string' ? isoDate(value.effective_to) : null }];
  });
}
