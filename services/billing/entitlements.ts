export type EntitlementStatus = 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled';

export type Entitlement = {
  status: EntitlementStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  processedWebhookIds: string[];
  /** The newest Stripe event applied to this entitlement. */
  lastWebhookCreatedAt: Date | null;
  /** Stable tie-breaker for two events created in the same second. */
  lastWebhookId: string | null;
};

export type EntitlementAccessReason = 'active' | 'trialing' | 'trial_expired' | 'past_due' | 'canceled' | 'inactive';

export type EntitlementAccess = {
  allowed: boolean;
  reason: EntitlementAccessReason;
  status: EntitlementStatus;
  trialEndsAt: Date | null;
};

/**
 * Computes the server-side access boundary from persisted billing state.
 * A trial is effective only through its end instant; payment failures and
 * cancellations stop paid features immediately until Stripe reports recovery.
 */
export function resolveEntitlementAccess(entitlement: Entitlement | undefined, now = new Date()): EntitlementAccess {
  if (!entitlement) return { allowed: false, reason: 'inactive', status: 'inactive', trialEndsAt: null };
  if (entitlement.status === 'trialing') {
    const ends = entitlement.trialEndsAt;
    if (!ends || ends.getTime() <= now.getTime()) return { allowed: false, reason: 'trial_expired', status: entitlement.status, trialEndsAt: ends };
    return { allowed: true, reason: 'trialing', status: entitlement.status, trialEndsAt: ends };
  }
  if (entitlement.status === 'active') return { allowed: true, reason: 'active', status: entitlement.status, trialEndsAt: entitlement.trialEndsAt };
  return { allowed: false, reason: entitlement.status, status: entitlement.status, trialEndsAt: entitlement.trialEndsAt };
}

export function startTrialAfterFirstUsableImport(entitlement: Entitlement, hasUsableCommittedImport: boolean, now: Date): Entitlement {
  if (!hasUsableCommittedImport || entitlement.trialStartedAt !== null) return entitlement;
  const trialEndsAt = new Date(now);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 14);
  return { ...entitlement, status: 'trialing', trialStartedAt: new Date(now), trialEndsAt };
}

export type BillingWebhook = {
  id: string;
  type: 'subscription_active' | 'subscription_past_due' | 'subscription_canceled';
  /** Stripe's event creation time, supplied by the verified webhook payload. */
  createdAt: Date;
};

/**
 * Applies verified Stripe events at most once and ignores events older than
 * the newest event already applied. Signature verification happens at the
 * HTTP edge; persistence should record every accepted event id in the same
 * transaction as the entitlement update.
 */
export function applyBillingWebhook(entitlement: Entitlement, event: BillingWebhook): Entitlement {
  if (entitlement.processedWebhookIds.includes(event.id)) return entitlement;
  if (entitlement.lastWebhookCreatedAt && event.createdAt < entitlement.lastWebhookCreatedAt) {
    return { ...entitlement, processedWebhookIds: [...entitlement.processedWebhookIds, event.id] };
  }
  if (
    entitlement.lastWebhookCreatedAt &&
    event.createdAt.getTime() === entitlement.lastWebhookCreatedAt.getTime() &&
    entitlement.lastWebhookId &&
    event.id <= entitlement.lastWebhookId
  ) {
    return { ...entitlement, processedWebhookIds: [...entitlement.processedWebhookIds, event.id] };
  }
  const statusByEvent: Record<BillingWebhook['type'], EntitlementStatus> = {
    subscription_active: 'active',
    subscription_past_due: 'past_due',
    subscription_canceled: 'canceled',
  };
  return {
    ...entitlement,
    status: statusByEvent[event.type],
    processedWebhookIds: [...entitlement.processedWebhookIds, event.id],
    lastWebhookCreatedAt: new Date(event.createdAt),
    lastWebhookId: event.id,
  };
}
