import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260912100000_consolidated_snapshot_index.sql', import.meta.url), 'utf8');

describe('consolidated snapshot index migration', () => {
  it('indexes the exact null-account consolidated latest-read predicate', () => {
    expect(migration).toMatch(/on public\.report_snapshots \(user_id, as_of_date desc, published_at desc, id desc\)/i);
    expect(migration).toMatch(/where account_id is null and report_type = 'consolidated_daily'/i);
  });
});
