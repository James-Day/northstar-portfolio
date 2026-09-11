import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260913160000_enforce_raw_file_cutoff.sql'), 'utf8');

describe('raw file retention cutoff migration', () => {
  it('sets new and existing pending files to a 30-day availability date', () => {
    expect(migration).toMatch(/update public\.raw_file_retention[\s\S]*available_at = uploaded_at \+ interval '30 days'[\s\S]*where status = 'pending'/i);
    expect(migration).toMatch(/insert into public\.raw_file_retention \(import_id, object_path, uploaded_at, available_at\)[\s\S]*new\.created_at \+ interval '30 days'/i);
  });

  it('keeps the claim RPC cutoff check independent of available_at', () => {
    expect(migration).toMatch(/r\.status = 'pending'[\s\S]*r\.available_at <= p_now[\s\S]*r\.uploaded_at <= p_now - interval '30 days'/i);
    expect(migration).toMatch(/r\.status = 'deleting'[\s\S]*r\.claimed_at < p_now - interval '15 minutes'/i);
  });
});
