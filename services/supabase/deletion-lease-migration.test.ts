import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260913150000_fence_deletion_leases.sql'), 'utf8');

describe('deletion lease migration contract', () => {
  it('fences completion and failure by the claimed attempt', () => {
    expect(migration).toMatch(/status = 'processing' and attempts = p_attempts/gi);
    expect(migration).toMatch(/p_attempts integer/gi);
    expect(migration).toMatch(/'ignored'::text/gi);
  });

  it('keeps later cleanup classes behind incomplete earlier classes', () => {
    expect(migration).toMatch(/not exists \([\s\S]*earlier\.request_id = i\.request_id[\s\S]*earlier\.status <> 'completed'[\s\S]*case earlier\.target_type/gi);
    expect(migration).toMatch(/raw_object.*10.*account.*20.*report_snapshots.*30.*billing_customer.*40.*profile.*50/gi);
  });

  it('keeps worker RPCs service-role-only', () => {
    expect(migration).toMatch(/revoke all on function public\.complete_user_deletion_plan_item\(uuid, integer, timestamptz\) from public/gi);
    expect(migration).toMatch(/grant execute on function public\.complete_user_deletion_plan_item\(uuid, integer, timestamptz\) to service_role/gi);
    expect(migration).toMatch(/revoke all on function public\.fail_user_deletion_plan_item\(uuid, integer, timestamptz, timestamptz, text, integer\) from public/gi);
  });
});
