import { describe, expect, it, vi } from 'vitest';
import { applyBillingWebhook, type Entitlement } from '@/services/billing/entitlements';
import { createStripeWebhookHandler } from '@/services/billing/stripe-webhook-handler';
import type { VerifiedStripeEvent } from '@/services/billing/stripe-http';

const initialEntitlement = (): Entitlement => ({
  status: 'inactive',
  trialStartedAt: null,
  trialEndsAt: null,
  processedWebhookIds: [],
  lastWebhookCreatedAt: null,
  lastWebhookId: null,
});

function event(id: string, created: number, type: string, object: Record<string, unknown>): VerifiedStripeEvent {
  const raw = { id, type, created, data: { object } };
  return { id, type, created, data: { object }, raw };
}

describe('billing lifecycle acceptance boundary', () => {
  it('is replay-safe, order-safe, and customer-mapping authoritative', async () => {
    let entitlement = initialEntitlement();
    const persisted = vi.fn(async (_userId: string, webhook: Parameters<typeof applyBillingWebhook>[1]) => {
      entitlement = applyBillingWebhook(entitlement, webhook);
      return entitlement;
    });
    const link = vi.fn(async () => undefined);
    const handler = createStripeWebhookHandler({
      billing: { applyVerifiedWebhook: persisted, linkStripeCustomer: link },
      resolveUserIdByStripeCustomerId: async (customerId) => customerId === 'cus_owner' ? 'user-owner' : undefined,
    });

    const active = event('evt_active', 2_000, 'customer.subscription.updated', {
      customer: 'cus_owner', status: 'active', metadata: { user_id: 'user-attacker' },
    });
    const delayedCancellation = event('evt_cancel_old', 1_000, 'customer.subscription.deleted', {
      customer: 'cus_owner', metadata: { user_id: 'user-attacker' },
    });
    const duplicateWithConflictingType = event('evt_active', 3_000, 'customer.subscription.deleted', {
      customer: 'cus_owner', metadata: { user_id: 'user-attacker' },
    });

    await expect(handler(active)).resolves.toMatchObject({ status: 'applied', userId: 'user-owner', eventType: 'subscription_active' });
    await expect(handler(delayedCancellation)).resolves.toMatchObject({ status: 'applied', userId: 'user-owner', eventType: 'subscription_canceled' });
    await expect(handler(duplicateWithConflictingType)).resolves.toMatchObject({ status: 'applied', userId: 'user-owner', eventType: 'subscription_canceled' });

    expect(entitlement.status).toBe('active');
    expect(entitlement.processedWebhookIds).toEqual(['evt_active', 'evt_cancel_old']);
    expect(persisted).toHaveBeenCalledTimes(3);
    expect(persisted.mock.calls.map(([userId]) => userId)).toEqual(['user-owner', 'user-owner', 'user-owner']);
    expect(link).toHaveBeenCalledTimes(3);
    expect(link).toHaveBeenCalledWith('user-owner', 'cus_owner');
  });

  it('deterministically resolves equal-timestamp lifecycle events by event id', async () => {
    let entitlement = initialEntitlement();
    const handler = createStripeWebhookHandler({
      billing: {
        applyVerifiedWebhook: async (_userId, webhook) => {
          entitlement = applyBillingWebhook(entitlement, webhook);
          return entitlement;
        },
      },
      resolveUserIdByStripeCustomerId: async () => 'user-owner',
    });

    await handler(event('evt_b', 2_000, 'customer.subscription.deleted', { customer: 'cus_owner' }));
    await handler(event('evt_a', 2_000, 'invoice.paid', { customer: 'cus_owner' }));

    expect(entitlement.status).toBe('canceled');
    expect(entitlement.processedWebhookIds).toEqual(['evt_b', 'evt_a']);
    expect(entitlement.lastWebhookId).toBe('evt_b');
  });
});
