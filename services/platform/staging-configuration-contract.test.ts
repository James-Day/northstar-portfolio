import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('staging configuration contract', () => {
  it('declares every service boundary without embedding credentials', async () => {
    const [env, worker, runbook] = await Promise.all([
      readFile(new URL('../../.env.example', import.meta.url), 'utf8'),
      readFile(new URL('../../wrangler.api.toml', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/LAUNCH_RUNBOOK.md', import.meta.url), 'utf8'),
    ]);
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MARKETSTACK_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_ANNUAL_PRICE_ID']) {
      expect(env, `${name} must be declared in the environment template`).toContain(`${name}=`);
    }
    expect(env).not.toMatch(/(sk_live_|sk_test_|whsec_)[A-Za-z0-9_]+/);
    for (const binding of ['IMPORT_QUEUE', 'REPORT_QUEUE', 'PRICE_QUEUE', 'RATE_LIMIT_COUNTER', 'REFRESH_CLAIM']) expect(worker).toContain(binding);
    expect(worker).toContain('crons =');
    expect(runbook).toMatch(/Supabase[\s\S]*Storage[\s\S]*Stripe[\s\S]*Marketstack/i);
  });

  it('requires staging evidence to remain distinct from production approval', async () => {
    const runbook = await readFile(new URL('../../docs/LAUNCH_RUNBOOK.md', import.meta.url), 'utf8');
    expect(runbook).toMatch(/operator must fill\s+in the hosted evidence/i);
    expect(runbook).toMatch(/`warn`\s+is acceptable for staging/i);
    expect(runbook).toMatch(/do not invite paying users/i);
  });
});
