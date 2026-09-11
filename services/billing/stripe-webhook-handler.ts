import type { BillingPersistence } from './persistence';
import type { BillingWebhook } from './entitlements';
import type { VerifiedStripeEvent } from './stripe-http';

export class UnresolvedStripeCustomerError extends Error {
  constructor(eventId: string) {
    super(`Stripe event ${eventId} could not be linked to a Northstar customer.`);
    this.name = 'UnresolvedStripeCustomerError';
  }
}

export type StripeWebhookHandlerDependencies = {
  billing: Pick<BillingPersistence, 'applyVerifiedWebhook' | 'linkStripeCustomer'>;
  /** Resolve a Stripe customer id against the server-owned billing mapping. */
  resolveUserIdByStripeCustomerId(customerId: string): Promise<string | undefined>;
};

export type StripeWebhookResult =
  | { status: 'ignored'; reason: 'unsupported_event' }
  | { status: 'applied'; userId: string; eventType: BillingWebhook['type'] };

/**
 * Converts only the subscription lifecycle events we understand into the
 * durable billing reducer. The caller must pass an event returned by
 * verifyStripeWebhook; persistence records the complete verified payload in
 * the same transaction as the entitlement update.
 */
export function createStripeWebhookHandler(dependencies: StripeWebhookHandlerDependencies) {
  return async function handleVerifiedWebhook(event: VerifiedStripeEvent): Promise<StripeWebhookResult> {
    const eventType = toBillingEvent(event);
    if (!eventType) return { status: 'ignored', reason: 'unsupported_event' };

    const userId = await resolveUserId(event, dependencies.resolveUserIdByStripeCustomerId);
    if (!userId) throw new UnresolvedStripeCustomerError(event.id);

    const customerId = stripeCustomerIdFromEvent(event);
    if (customerId && dependencies.billing.linkStripeCustomer)
      await dependencies.billing.linkStripeCustomer(userId, customerId);

    await dependencies.billing.applyVerifiedWebhook(userId, {
      id: event.id,
      type: eventType,
      createdAt: new Date(event.created * 1000),
    }, event.raw);
    return { status: 'applied', userId, eventType };
  };
}

function stripeCustomerIdFromEvent(event: VerifiedStripeEvent): string | undefined {
  const object = asRecord(event.data.object);
  const customer = stringAt(object, 'customer');
  return customer && /^cus_[A-Za-z0-9]+$/.test(customer) ? customer : undefined;
}

function toBillingEvent(event: VerifiedStripeEvent): BillingWebhook['type'] | undefined {
  if (event.type === 'customer.subscription.deleted') return 'subscription_canceled';
  if (event.type === 'invoice.payment_failed') return 'subscription_past_due';
  if (event.type === 'invoice.paid') return 'subscription_active';
  if (event.type !== 'customer.subscription.created' && event.type !== 'customer.subscription.updated' && event.type !== 'checkout.session.completed') return undefined;

  const status = stringAt(event.data, 'object', 'status');
  if (status === 'canceled' || status === 'unpaid') return 'subscription_canceled';
  if (status === 'past_due' || status === 'incomplete' || status === 'incomplete_expired') return 'subscription_past_due';
  return 'subscription_active';
}

async function resolveUserId(event: VerifiedStripeEvent, lookup: (customerId: string) => Promise<string | undefined>): Promise<string | undefined> {
  const object = asRecord(event.data.object);
  const customerId = stringAt(object, 'customer') ?? stringAt(object, 'subscription_details', 'metadata', 'customer_id');

  // Once a Stripe customer has been linked, that server-owned mapping is the
  // authority. Event metadata is useful only to bootstrap Checkout completion;
  // accepting it first would let a later dashboard-edited event redirect a
  // mapped customer to another Northstar user.
  if (customerId) {
    const mappedUserId = await lookup(customerId);
    if (mappedUserId) return mappedUserId;
  }
  const metadataUserId = stringAt(object, 'metadata', 'user_id');
  if (metadataUserId) return metadataUserId;
  const clientReferenceId = stringAt(object, 'client_reference_id');
  if (clientReferenceId) return clientReferenceId;
  return undefined;
}

function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
