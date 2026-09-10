import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('market-data pending-symbol migration', () => {
  it('stores a non-negative durable pending-publication count', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20260913100000_market_data_pending_symbols.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/publication_pending_symbols integer not null default 0/);
    expect(sql).toMatch(/publication_pending_symbols >= 0/);
  });
});
