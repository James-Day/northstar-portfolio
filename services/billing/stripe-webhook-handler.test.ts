import { describe, expect, it, vi } from 'vitest';
import { createStripeWebhookHandler, UnresolvedStripeCustomerError } from './stripe-webhook-handler';
import type { VerifiedStripeEvent } from './stripe-http';

const base = (type: string, object: Record<string, unknown>): VerifiedStripeEvent => ({
  id: 'evt_123', type, created: 1_767_000_000, data: { object }, raw: { id: 'evt_123', type, created: 1_767_000_000, data: { object } },
});
const entitlement = { status: 'active' as const, trialStartedAt: null, trialEndsAt: null, processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null };

describe('Stripe webhook durable adapter', () => {
  it('maps subscription status and persists the complete verified payload', async () => {
    const apply = vi.fn(async () => entitlement);
    const handler = createStripeWebhookHandler({ billing: { applyVerifiedWebhook: apply }, resolveUserIdByStripeCustomerId: async () => undefined });
    const event = base('customer.subscription.updated', { metadata: { user_id: 'user-1' }, status: 'active', customer: 'cus_1' });
    await expect(handler(event)).resolves.toEqual({ status: 'applied', userId: 'user-1', eventType: 'subscription_active' });
    expect(apply).toHaveBeenCalledWith('user-1', { id: 'evt_123', type: 'subscription_active', createdAt: new Date(1_767_000_000 * 1000) }, event.raw);
  });

  it('uses server-owned customer mapping when metadata is absent', async () => {
    const apply = vi.fn(async () => entitlement);
    const lookup = vi.fn(async (customerId: string) => customerId === 'cus_9' ? 'user-9' : undefined);
    const handler = createStripeWebhookHandler({ billing: { applyVerifiedWebhook: apply }, resolveUserIdByStripeCustomerId: lookup });
    await expect(handler(base('invoice.payment_failed', { customer: 'cus_9' }))).resolves.toMatchObject({ status: 'applied', userId: 'user-9', eventType: 'subscription_past_due' });
    expect(lookup).toHaveBeenCalledWith('cus_9');
  });

  it('acknowledges event types that do not affect entitlement without writing state', async () => {
    const apply = vi.fn(async () => entitlement);
    const handler = createStripeWebhookHandler({ billing: { applyVerifiedWebhook: apply }, resolveUserIdByStripeCustomerId: async () => 'user-1' });
    await expect(handler(base('payment_method.attached', {}))).resolves.toEqual({ status: 'ignored', reason: 'unsupported_event' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('fails recognized events without an ownership mapping so delivery can retry', async () => {
    const handler = createStripeWebhookHandler({ billing: { applyVerifiedWebhook: vi.fn() }, resolveUserIdByStripeCustomerId: async () => undefined });
    await expect(handler(base('customer.subscription.deleted', { customer: 'cus_missing' }))).rejects.toBeInstanceOf(UnresolvedStripeCustomerError);
  });
});
