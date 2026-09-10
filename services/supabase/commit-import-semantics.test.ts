import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260909170000_commit_import_rpc.sql', import.meta.url), 'utf8');

describe('commit import financial semantics', () => {
  it('expands each DRIP source row into one dividend and one reinvestment buy', () => {
    expect(migration).toMatch(/if v_type = 'drip_buy' then[\s\S]*insert into public\.ledger_entries[\s\S]*'dividend'/i);
    expect(migration).toMatch(/case when v_type = 'drip_buy' then -abs\(\(v_activity ->> 'amount'\)::numeric\)/i);
    expect(migration).toMatch(/if v_type in \('buy', 'drip_buy'\) then[\s\S]*insert into public\.lots/i);
  });

  it('keeps source-row uniqueness type-aware so the paired entries are not rejected', () => {
    expect(migration).toMatch(/drop index public\.ledger_entries_import_source_row_unique/i);
    expect(migration).toMatch(/create unique index ledger_entries_import_source_row_type_unique on public\.ledger_entries\(source_row_id, entry_type\)/i);
  });
});
