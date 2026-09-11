import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260913170000_fence_raw_retention_leases.sql'), 'utf8');

describe('raw-file retention lease fencing migration', () => {
  it('requires the claim attempt for completion and failure RPCs', () => {
    expect(migration).toMatch(/complete_raw_file_retention\(\s*p_id uuid,\s*p_attempts integer/i);
    expect(migration).toMatch(/fail_raw_file_retention\(\s*p_id uuid,\s*p_attempts integer/i);
    expect(migration).toMatch(/status = 'deleting' and attempts = p_attempts/i);
  });

  it('keeps the new RPCs service-only', () => {
    expect(migration).toMatch(/revoke all on function public\.complete_raw_file_retention\(uuid, integer, timestamptz\) from public/i);
    expect(migration).toMatch(/grant execute on function public\.complete_raw_file_retention\(uuid, integer, timestamptz\) to service_role/i);
    expect(migration).toMatch(/revoke all on function public\.fail_raw_file_retention\(uuid, integer, timestamptz, timestamptz, text, integer\) from public/i);
    expect(migration).toMatch(/grant execute on function public\.fail_raw_file_retention\(uuid, integer, timestamptz, timestamptz, text, integer\) to service_role/i);
  });
});
