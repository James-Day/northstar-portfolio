import { describe, expect, it, vi } from 'vitest';
import { SupabaseBillingRepository } from './billing-repository';

const customer = {
  user_id: '11111111-1111-4111-8111-111111111111', entitlement_status: 'trialing',
  trial_started_at: '2026-01-01T00:00:00.000Z', trial_ends_at: '2026-01-15T00:00:00.000Z',
  last_webhook_created_at: null, last_webhook_id: null,
};

function mockFetcher(body: unknown) {
  return vi.fn((..._args: Parameters<typeof fetch>) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
}

describe('SupabaseBillingRepository', () => {
  it('reads entitlement through caller-scoped RLS and maps timestamps', async () => {
    const fetcher = mockFetcher([customer]);
    const result = await new SupabaseBillingRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', fetcher }).getEntitlement(customer.user_id, 'user-token');
    expect(result?.status).toBe('trialing');
    expect(result?.trialEndsAt).toEqual(new Date('2026-01-15T00:00:00.000Z'));
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { authorization: 'Bearer user-token', apikey: 'anon' } });
  });

  it('starts the trial through the atomic RPC and preserves user ownership', async () => {
    const fetcher = mockFetcher([customer]);
    const result = await new SupabaseBillingRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', fetcher }).startTrialAfterCommittedImport(customer.user_id, 'user-token');
    expect(result?.status).toBe('trialing');
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/start_trial_after_committed_import');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { authorization: 'Bearer user-token' } });
  });

  it('requires a service role for verified webhook writes and calls the atomic RPC', async () => {
    const fetcher = mockFetcher([customer]);
    const repository = new SupabaseBillingRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', serviceRoleKey: 'service', fetcher });
    await repository.applyVerifiedWebhook(customer.user_id, { id: 'evt_1', type: 'subscription_active', createdAt: new Date('2026-01-02T00:00:00Z') }, { id: 'evt_1' });
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/apply_billing_webhook');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ p_user_id: customer.user_id, p_event_id: 'evt_1' });
  });

  it('resolves Stripe customer ownership through the service role mapping', async () => {
    const fetcher = mockFetcher([{ user_id: customer.user_id }]);
    const repository = new SupabaseBillingRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', serviceRoleKey: 'service', fetcher });
    await expect(repository.findUserIdByStripeCustomerId('cus_123')).resolves.toBe(customer.user_id);
    expect(String(fetcher.mock.calls[0][0])).toContain('stripe_customer_id=eq.cus_123');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { apikey: 'service', authorization: 'Bearer service' } });
  });

  it('links a Checkout-created customer through the service-only RPC', async () => {
    const fetcher = mockFetcher([]);
    const repository = new SupabaseBillingRepository({ supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon', serviceRoleKey: 'service', fetcher });
    await repository.linkStripeCustomer(customer.user_id, 'cus_123');
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/link_stripe_customer');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_user_id: customer.user_id, p_customer_id: 'cus_123' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { apikey: 'service', authorization: 'Bearer service' } });
  });
});
