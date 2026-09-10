import { describe, expect, it } from 'vitest';
import { runLaunchPreflight } from './launch-preflight';

const baseEnv = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  MARKETSTACK_API_KEY: 'marketstack',
  MARKETSTACK_MONTHLY_CAP: '100',
  STRIPE_SECRET_KEY: 'sk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
  STRIPE_MONTHLY_PRICE_ID: 'price_monthly',
  STRIPE_ANNUAL_PRICE_ID: 'price_annual',
};

function files(): Record<string, string> {
  return {
    'wrangler.api.toml': 'IMPORT_QUEUE REPORT_QUEUE PRICE_QUEUE dead_letter_queue = "northstar-imports-dlq" dead_letter_queue = "northstar-reports-dlq" dead_letter_queue = "northstar-prices-dlq"',
    'docs/LAUNCH_RUNBOOK.md': 'rollback migration queue',
    'supabase/migrations': 'migration',
  };
}

function run(env: Record<string, string | undefined> = baseEnv) {
  const keyFor = (path: string) => path.includes('wrangler.api.toml') ? 'wrangler.api.toml' : path.includes('LAUNCH_RUNBOOK.md') ? 'docs/LAUNCH_RUNBOOK.md' : path.includes('supabase') ? 'supabase/migrations' : path;
  return runLaunchPreflight({
    env,
    repoRoot: '/repo',
    readFile: (path) => files()[keyFor(path)] ?? '',
    existsPath: (path) => Boolean(files()[keyFor(path)]),
  });
}

describe('launch preflight', () => {
  it('passes repository checks with configured staging inputs', () => {
    const result = run();
    expect(result.passed).toBe(true);
    expect(result.checks.find((item) => item.id === 'env.SUPABASE_SERVICE_ROLE_KEY')?.message).not.toContain('service');
  });

  it('fails closed when a required secret is missing', () => {
    const result = run({ ...baseEnv, STRIPE_WEBHOOK_SECRET: '' });
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.id === 'env.STRIPE_WEBHOOK_SECRET')?.status).toBe('fail');
  });

  it('rejects mismatched Supabase URLs and unbounded request caps', () => {
    const result = run({ ...baseEnv, SUPABASE_URL: 'https://other.supabase.co', MARKETSTACK_MONTHLY_CAP: '10001' });
    expect(result.checks.find((item) => item.id === 'env.supabase-url-match')?.status).toBe('fail');
    expect(result.checks.find((item) => item.id === 'env.marketstack-cap')?.status).toBe('fail');
  });

  it('requires a live Stripe key and commercial provider plan in production', () => {
    const result = run({ ...baseEnv, APP_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_example', MARKETSTACK_PLAN: 'free' });
    expect(result.checks.find((item) => item.id === 'billing.live-key')?.status).toBe('fail');
    expect(result.checks.find((item) => item.id === 'market-data.commercial-plan')?.status).toBe('fail');
  });

  it('accepts explicitly selected production credentials and plan', () => {
    const result = run({ ...baseEnv, APP_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_example', MARKETSTACK_PLAN: 'basic' });
    expect(result.checks.find((item) => item.id === 'billing.live-key')?.status).toBe('pass');
    expect(result.checks.find((item) => item.id === 'market-data.commercial-plan')?.status).toBe('pass');
    expect(result.passed).toBe(true);
  });
});
