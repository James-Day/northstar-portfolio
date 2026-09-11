import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import { validateHistoricalVerificationManifest, type HistoricalVerificationManifestCase } from '@/services/market-data/historical-verification-manifest';

const pending = (symbol: string): HistoricalVerificationManifestCase => ({
  symbol,
  tradingDate: isoDate('2024-01-02'),
  expectedClose: null,
  category: 'large_cap',
  evidence: { status: 'pending', sourceName: '', sourceUrl: '', retrievedOn: isoDate('2026-09-13'), locator: '', reviewer: '' },
});

const verified = (): HistoricalVerificationManifestCase => ({
  symbol: 'AAPL',
  tradingDate: isoDate('2024-01-02'),
  expectedClose: decimalString('185.64'),
  category: 'large_cap',
  evidence: { status: 'verified', sourceName: 'Issuer archive', sourceUrl: 'https://issuer.example/archive', retrievedOn: isoDate('2026-09-13'), locator: 'page 4 / row 2', reviewer: 'operator-1' },
});

describe('historical verification manifest contract', () => {
  it('keeps the checked-in candidate manifest explicitly pending', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../config/market-data/historical-verification-cases.json', import.meta.url), 'utf8')) as { status: string; cases: HistoricalVerificationManifestCase[] };
    const result = validateHistoricalVerificationManifest(manifest.cases);
    expect(manifest.status).toBe('pending_independent_review');
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.pending).toHaveLength(6);
    expect(result.verifiedCases).toEqual([]);
  });

  it('keeps pending candidate rows out of the verified fixture set', () => {
    const result = validateHistoricalVerificationManifest([pending('AAPL'), pending('SPY')]);
    expect(result).toMatchObject({ ready: false, verifiedCases: [], errors: [] });
    expect(result.pending.map((row) => row.symbol)).toEqual(['AAPL', 'SPY']);
  });

  it('requires independently attributable evidence for a verified value', () => {
    const row = verified();
    row.evidence.sourceUrl = 'http://issuer.example/archive';
    row.evidence.reviewer = '';
    const result = validateHistoricalVerificationManifest([row]);
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'case[0].evidence.sourceUrl must use HTTPS.',
      'case[0].evidence.reviewer is required.',
    ]));
  });

  it('converts only complete verified rows and preserves evidence in the comparison case', () => {
    const result = validateHistoricalVerificationManifest([verified()]);
    expect(result).toMatchObject({ ready: true, pending: [], errors: [] });
    expect(result.verifiedCases).toEqual([expect.objectContaining({
      symbol: 'AAPL', expectedClose: '185.64', category: 'large_cap',
      evidence: 'Issuer archive — page 4 / row 2 (reviewed by operator-1 on 2026-09-13)',
    })]);
  });

  it('fails closed when verified evidence omits its expected close', () => {
    const row = verified();
    row.expectedClose = null;
    const result = validateHistoricalVerificationManifest([row]);
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('case[0].expectedClose is required for verified evidence.');
  });

  it('rejects duplicate cases and non-positive expected closes', () => {
    const first = verified();
    first.expectedClose = decimalString('0');
    const second = verified();
    const result = validateHistoricalVerificationManifest([first, second]);
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'case[0].expectedClose must be a positive finite decimal.',
      'case[1] duplicates an earlier symbol/date case.',
    ]));
  });

  it('rejects impossible trading dates before independent review', () => {
    const row = verified();
    row.tradingDate = '2026-02-30' as never;
    const result = validateHistoricalVerificationManifest([row]);
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('case[0].tradingDate must be a valid calendar date.');
  });
});
