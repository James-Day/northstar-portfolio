import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRequestApi } from './api';

const worker = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

describe('Worker scheduled wiring', () => {
  it('runs durable deletion only with Supabase and Stripe server configuration', () => {
    expect(worker).toMatch(/handleScheduledDeletion\(event, context/);
    expect(worker).toMatch(/new SupabaseDeletionExecutorRepository/);
    expect(worker).toMatch(/new SupabaseDeletionEffects/);
    expect(worker).toMatch(/if \(environment\.STRIPE_SECRET_KEY\)/);
  });

  it('keeps Stripe cancellation server-side', () => {
    expect(worker).toMatch(/createStripeCustomerCancellation/);
    expect(worker).not.toMatch(/NEXT_PUBLIC.*STRIPE/);
  });

  it('guards market-data refresh independently from other scheduled jobs', () => {
    expect(worker).toMatch(/isMarketstackScheduledRefreshEnabled\(environment\)/);
  });

  it('fails closed for production requests when the shared counter binding is absent', async () => {
    const response = await resolveRequestApi({ APP_ENV: 'production' }).request('https://api.test/health');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('keeps the in-memory limiter available for local development only', async () => {
    const response = await resolveRequestApi({ APP_ENV: 'development' }).request('https://api.test/health');
    expect(response.status).toBe(200);
  });
});
