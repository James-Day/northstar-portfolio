import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../supabase/migrations/20260914150000_restore_serialized_lot_rebuild_wrappers.sql', import.meta.url);

describe('final import wrapper migration', () => {
  it('restores account-serialized lot rebuilding after issue validation', async () => {
    const sql = (await readFile(migrationPath, 'utf8')).toLowerCase();
    expect(sql).toMatch(/create or replace function public\.commit_import[\s\S]*?security definer/);
    expect(sql).toMatch(/perform public\.validate_import_issue_resolutions\(p_import_id\)[\s\S]*?v_result := public\.commit_import_unlocked[\s\S]*?perform public\.rebuild_account_lots\(v_account_id\)/);
    expect(sql).toMatch(/create or replace function public\.undo_import[\s\S]*?v_result := public\.undo_import_unlocked[\s\S]*?perform public\.rebuild_account_lots\(v_account_id\)/);
  });

  it('removes direct authenticated access to unlocked mutations and derived lots', async () => {
    const sql = (await readFile(migrationPath, 'utf8')).toLowerCase();
    expect(sql).toMatch(/revoke all on function public\.rebuild_account_lots\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.commit_import_unlocked\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.undo_import_unlocked\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.commit_import\(uuid\) to authenticated/);
  });
});
