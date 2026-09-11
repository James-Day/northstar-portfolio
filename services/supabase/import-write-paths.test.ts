import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20260913120000_lock_import_source_writes.sql', import.meta.url), 'utf8');

describe('immutable import evidence migration', () => {
  it('removes direct client mutation privileges from imports and source rows', () => {
    expect(migration).toMatch(/revoke insert, update, delete on public\.imports, public\.import_source_rows from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select on public\.imports, public\.import_source_rows to authenticated/i);
  });

  it('exposes discard only through an authenticated RPC and protects the unlocked commit path', () => {
    expect(migration).toMatch(/create or replace function public\.discard_import\(p_import_id uuid\)[\s\S]*security definer/i);
    expect(migration).toMatch(/grant execute on function public\.discard_import\(uuid\) to authenticated/i);
    expect(migration).toMatch(/revoke execute on function public\.commit_import_unlocked\(uuid\) from authenticated/i);
  });
});
