import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260910220001_rebuild_fifo_lots.sql', import.meta.url), 'utf8');

describe('persisted FIFO lot rebuild migration', () => {
  it('replaces lot projections and records sale-to-lot matches in chronological FIFO order', () => {
    expect(migration).toMatch(/create table public\.lot_matches/);
    expect(migration).toMatch(/delete from public\.lot_matches where account_id = p_account_id/);
    expect(migration).toMatch(/delete from public\.lots where account_id = p_account_id/);
    expect(migration).toMatch(/order by e\.effective_date asc, e\.id asc/);
    expect(migration).toMatch(/order by l\.acquired_on asc nulls first, l\.opening_entry_id asc nulls last, l\.id asc/);
    expect(migration).toMatch(/insert into public\.lot_matches/);
    expect(migration).toMatch(/raise exception 'Sell % exceeds available lots by %\.'/);
  });

  it('rebuilds after both serialized commit and undo mutations', () => {
    expect(migration).toMatch(/v_result := public\.commit_import_unlocked\(p_import_id\);[\s\S]*perform public\.rebuild_account_lots\(v_account_id\);/);
    expect(migration).toMatch(/v_result := public\.undo_import_unlocked\(p_import_id\);[\s\S]*perform public\.rebuild_account_lots\(v_account_id\);/);
  });
});
