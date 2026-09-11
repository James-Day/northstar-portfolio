import type { Entitlement, BillingWebhook } from './entitlements';

/** Persistence boundary for billing state. Implementations must make each mutation atomic. */
export type BillingPersistence = {
  getEntitlement(userId: string, accessToken: string): Promise<Entitlement | undefined>;
  startTrialAfterCommittedImport(userId: string, accessToken: string): Promise<Entitlement | undefined>;
  applyVerifiedWebhook(userId: string, event: BillingWebhook, payload?: Record<string, unknown>): Promise<Entitlement>;
  /** Persist the Stripe customer created by Checkout under the authenticated owner. */
  linkStripeCustomer?(userId: string, customerId: string): Promise<void>;
};
