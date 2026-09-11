import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
});
