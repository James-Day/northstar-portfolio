import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('user account cleanup migration', () => {
  it('deletes restricted dependents before the account', () => {
    const sql = readFileSync('supabase/migrations/20260912110000_user_account_cleanup_rpc.sql', 'utf8');
    expect(sql.indexOf('delete from public.lots')).toBeLessThan(sql.indexOf('delete from public.accounts'));
    expect(sql.indexOf('delete from public.ledger_entries')).toBeLessThan(sql.indexOf('delete from public.accounts'));
    expect(sql).toMatch(/grant execute on function public\.delete_user_account_data\(uuid, uuid\) to service_role/);
  });
});
