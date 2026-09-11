import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('market-data unresolved-alias migration', () => {
  it('adds a non-negative durable counter to job runs', () => {
    const sql = readFileSync('supabase/migrations/20260912130000_market_data_unresolved_aliases.sql', 'utf8');
    expect(sql).toMatch(/alter table public\.market_data_job_runs add column if not exists unresolved_instrument_count integer not null default 0/i);
    expect(sql).toMatch(/check\s*\(unresolved_instrument_count\s*>=\s*0\)/i);
  });
});
