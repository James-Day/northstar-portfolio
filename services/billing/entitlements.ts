export type EntitlementStatus = 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled';

export type Entitlement = {
  status: EntitlementStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  processedWebhookIds: string[];
};

export function startTrialAfterFirstUsableImport(entitlement: Entitlement, hasUsableCommittedImport: boolean, now: Date): Entitlement {
  if (!hasUsableCommittedImport || entitlement.trialStartedAt !== null) return entitlement;
  const trialEndsAt = new Date(now);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 14);
  return { ...entitlement, status: 'trialing', trialStartedAt: new Date(now), trialEndsAt };
}

export type BillingWebhook = {
  id: string;
  type: 'subscription_active' | 'subscription_past_due' | 'subscription_canceled';
};

/** Applies verified Stripe events at most once; signature verification happens at the HTTP edge. */
export function applyBillingWebhook(entitlement: Entitlement, event: BillingWebhook): Entitlement {
  if (entitlement.processedWebhookIds.includes(event.id)) return entitlement;
  const statusByEvent: Record<BillingWebhook['type'], EntitlementStatus> = {
    subscription_active: 'active',
    subscription_past_due: 'past_due',
    subscription_canceled: 'canceled',
  };
  return { ...entitlement, status: statusByEvent[event.type], processedWebhookIds: [...entitlement.processedWebhookIds, event.id] };
}
