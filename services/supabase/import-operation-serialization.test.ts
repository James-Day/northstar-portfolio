import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260910200001_serialize_account_import_operations.sql', import.meta.url),
  'utf8',
);

describe('account import operation serialization migration', () => {
  it('wraps both commit and undo RPCs with a transaction-scoped account lock', () => {
    expect(migration).toMatch(/alter function public\.commit_import\(uuid\) rename to commit_import_unlocked;/);
    expect(migration).toMatch(/alter function public\.undo_import\(uuid\) rename to undo_import_unlocked;/);

    const lockCalls = migration.match(/pg_advisory_xact_lock\(hashtextextended\(v_account_id::text, 0\)\)/g);
    expect(lockCalls).toHaveLength(2);
    expect(migration).toMatch(/return public\.commit_import_unlocked\(p_import_id\);/);
    expect(migration).toMatch(/return public\.undo_import_unlocked\(p_import_id\);/);
  });

  it('keeps the wrappers behind the authenticated RPC boundary', () => {
    expect(migration).toMatch(/revoke all on function public\.commit_import\(uuid\) from public;[\s\S]*grant execute on function public\.commit_import\(uuid\) to authenticated;/);
    expect(migration).toMatch(/revoke all on function public\.undo_import\(uuid\) from public;[\s\S]*grant execute on function public\.undo_import\(uuid\) to authenticated;/);
  });
});
