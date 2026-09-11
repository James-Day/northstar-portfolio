import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BillingConfigurationError,
  validateStripeBillingConfiguration,
} from '@/services/billing/stripe-http';

export type LaunchCheckStatus = 'pass' | 'fail' | 'warn';

export type LaunchCheck = {
  id: string;
  status: LaunchCheckStatus;
  message: string;
};

export type LaunchPreflightResult = {
  environment: 'staging' | 'production';
  checks: LaunchCheck[];
  passed: boolean;
};

export type LaunchPreflightOptions = {
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  readFile?: (path: string) => string;
  existsPath?: (path: string) => boolean;
};

const REQUIRED_PRODUCTION_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MARKETSTACK_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_ANNUAL_PRICE_ID',
] as const;

const PLACEHOLDER_VALUES = new Set(['', 'replace-me', 'changeme', 'your-key-here', 'undefined', 'null']);

function isConfigured(value: string | undefined): boolean {
  return value !== undefined && !PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function check(id: string, status: LaunchCheckStatus, message: string): LaunchCheck {
  return { id, status, message };
}

/**
 * Validate the locally checked-in portion of staging/production launch readiness.
 * This intentionally cannot prove that a hosted service is reachable; those
 * checks belong to the authenticated staging runbook and must be recorded as
 * evidence before the final launch gate is approved.
 */
export function runLaunchPreflight(options: LaunchPreflightOptions = {}): LaunchPreflightResult {
  const env = options.env ?? (typeof process === 'undefined' ? {} : process.env);
  const environment = env.APP_ENV === 'production' ? 'production' : 'staging';
  const root = options.repoRoot ?? (typeof process === 'undefined' ? '.' : process.cwd());
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const existsPath = options.existsPath ?? existsSync;
  const checks: LaunchCheck[] = [];

  for (const name of REQUIRED_PRODUCTION_VARS) {
    const configured = isConfigured(env[name]);
    checks.push(check(`env.${name}`, configured ? 'pass' : 'fail', configured ? `${name} is configured.` : `${name} is missing or still a placeholder.`));
  }

  checks.push(env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')
    ? check('billing.webhook-format', 'pass', 'Stripe webhook secret uses the expected format.')
    : check('billing.webhook-format', 'fail', 'STRIPE_WEBHOOK_SECRET must use a whsec_ secret.'));
  try {
    validateStripeBillingConfiguration({
      monthlyPriceId: env.STRIPE_MONTHLY_PRICE_ID,
      annualPriceId: env.STRIPE_ANNUAL_PRICE_ID,
    });
    checks.push(check('billing.price-format', 'pass', 'Stripe monthly and annual price IDs use distinct expected identifiers.'));
  } catch (error) {
    checks.push(check('billing.price-format', 'fail', error instanceof BillingConfigurationError ? error.message : 'Stripe price configuration is invalid.'));
  }

  const monthlyCents = env.STRIPE_MONTHLY_PRICE_CENTS;
  const annualCents = env.STRIPE_ANNUAL_PRICE_CENTS;
  const amountsConfigured = monthlyCents !== undefined || annualCents !== undefined;
  let amountsValid = false;
  try {
    validateStripeBillingConfiguration({
      monthlyPriceId: env.STRIPE_MONTHLY_PRICE_ID,
      annualPriceId: env.STRIPE_ANNUAL_PRICE_ID,
      monthlyPriceCents: monthlyCents,
      annualPriceCents: annualCents,
    }, { requireAmounts: environment === 'production' });
    amountsValid = monthlyCents === '500' && annualCents === '4900';
  } catch {
    amountsValid = false;
  }
  checks.push(amountsValid
    ? check('billing.price-amounts', 'pass', 'Stripe prices match $5 monthly and $49 annual pricing.')
    : amountsConfigured || environment === 'production'
      ? check('billing.price-amounts', 'fail', 'Stripe price amounts must be 500 monthly cents and 4900 annual cents.')
      : check('billing.price-amounts', 'warn', 'Staging should record 500 monthly cents and 4900 annual cents after Stripe test prices are created.'));

  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serverUrl = env.SUPABASE_URL;
  checks.push(publicUrl && serverUrl && publicUrl === serverUrl
    ? check('env.supabase-url-match', 'pass', 'Browser and server Supabase URLs match.')
    : check('env.supabase-url-match', 'fail', 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL must match.'));

  const cap = Number(env.MARKETSTACK_MONTHLY_CAP ?? '100');
  checks.push(Number.isInteger(cap) && cap > 0 && cap <= 10_000
    ? check('env.marketstack-cap', 'pass', `Marketstack monthly cap is bounded at ${cap} requests.`)
    : check('env.marketstack-cap', 'fail', 'MARKETSTACK_MONTHLY_CAP must be an integer between 1 and 10,000.'));

  const wranglerPath = resolve(root, 'wrangler.api.toml');
  const fileCheckWithPath = (id: string, path: string, expected: RegExp) => existsPath(path)
    ? (expected.test(readFile(path)) ? check(id, 'pass', `Verified ${path}`) : check(id, 'fail', `Launch artifact does not contain the required evidence: ${path}`))
    : check(id, 'fail', `Required launch artifact is missing: ${path}`);
  checks.push(fileCheckWithPath('deploy.wrangler-queues', wranglerPath, /IMPORT_QUEUE[\s\S]*REPORT_QUEUE[\s\S]*PRICE_QUEUE/));
  checks.push(fileCheckWithPath('deploy.wrangler-consumers', wranglerPath, /dead_letter_queue\s*=\s*"northstar-imports-dlq"[\s\S]*dead_letter_queue\s*=\s*"northstar-reports-dlq"[\s\S]*dead_letter_queue\s*=\s*"northstar-prices-dlq"/));
  checks.push(fileCheckWithPath('deploy.runbook', resolve(root, 'docs/LAUNCH_RUNBOOK.md'), /rollback[\s\S]*migration[\s\S]*queue/i));
  checks.push(fileCheckWithPath('deploy.backup-restore-drill', resolve(root, 'docs/BACKUP_RESTORE_DRILL.md'), /RPO[\s\S]*RTO[\s\S]*isolated/i));
  checks.push(existsPath(resolve(root, 'supabase/migrations')) ? check('deploy.migrations', 'pass', `Verified ${resolve(root, 'supabase/migrations')}`) : check('deploy.migrations', 'fail', `Required launch path is missing: ${resolve(root, 'supabase/migrations')}`));

  // Staging may use test Stripe credentials, but a production launch must
  // explicitly use live credentials and a commercial Marketstack plan.
  if (environment === 'production') {
    checks.push(env.STRIPE_SECRET_KEY?.startsWith('sk_live_')
      ? check('billing.live-key', 'pass', 'Stripe live secret is configured.')
      : check('billing.live-key', 'fail', 'Production requires a Stripe live secret key.'));
    checks.push(env.MARKETSTACK_PLAN?.toLowerCase() === 'basic' || env.MARKETSTACK_PLAN?.toLowerCase() === 'professional' || env.MARKETSTACK_PLAN?.toLowerCase() === 'business'
      ? check('market-data.commercial-plan', 'pass', 'A commercial Marketstack plan is selected.')
      : check('market-data.commercial-plan', 'fail', 'Production requires an explicitly recorded commercial Marketstack plan.'));
  } else {
    checks.push(check('billing.live-key', 'warn', 'Staging preflight does not require Stripe live credentials.'));
    checks.push(check('market-data.commercial-plan', 'warn', 'Staging may use the free Marketstack plan; production must record a commercial plan.'));
  }

  return { environment, checks, passed: checks.every((item) => item.status !== 'fail') };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('launch-preflight.ts')) {
  const result = runLaunchPreflight();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
