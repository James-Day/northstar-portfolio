import { describe, expect, it } from 'vitest';
import { applyBillingWebhook, resolveEntitlementAccess, startTrialAfterFirstUsableImport, type Entitlement } from '@/services/billing/entitlements';

const inactive = (): Entitlement => ({ status: 'inactive', trialStartedAt: null, trialEndsAt: null, processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null });

describe('billing entitlements', () => {
  it('starts exactly one 14-day trial after the first usable committed import', () => {
    const trial = startTrialAfterFirstUsableImport(inactive(), true, new Date('2026-01-01T00:00:00Z'));
    expect(trial).toMatchObject({ status: 'trialing', trialStartedAt: new Date('2026-01-01T00:00:00Z'), trialEndsAt: new Date('2026-01-15T00:00:00Z') });
    expect(startTrialAfterFirstUsableImport(trial, true, new Date('2026-02-01T00:00:00Z'))).toBe(trial);
  });

  it('does not start a trial for a non-usable import', () => {
    expect(startTrialAfterFirstUsableImport(inactive(), false, new Date())).toMatchObject({ status: 'inactive', trialStartedAt: null });
  });

  it('handles duplicate webhooks idempotently', () => {
    const first = applyBillingWebhook(inactive(), { id: 'event-1', type: 'subscription_active', createdAt: new Date('2026-01-02T00:00:00Z') });
    expect(applyBillingWebhook(first, { id: 'event-1', type: 'subscription_canceled', createdAt: new Date('2026-01-03T00:00:00Z') })).toBe(first);
  });

  it('ignores an older event that arrives after a newer event', () => {
    const active = applyBillingWebhook(inactive(), { id: 'event-new', type: 'subscription_active', createdAt: new Date('2026-01-03T00:00:00Z') });
    const stale = applyBillingWebhook(active, { id: 'event-old', type: 'subscription_canceled', createdAt: new Date('2026-01-02T00:00:00Z') });
    expect(stale).toEqual({ ...active, processedWebhookIds: ['event-new', 'event-old'] });
  });

  it('uses the event id as a deterministic tie-breaker for equal timestamps', () => {
    const first = applyBillingWebhook(inactive(), { id: 'event-b', type: 'subscription_active', createdAt: new Date('2026-01-03T00:00:00Z') });
    const stale = applyBillingWebhook(first, { id: 'event-a', type: 'subscription_canceled', createdAt: new Date('2026-01-03T00:00:00Z') });
    expect(stale.status).toBe('active');
    expect(stale.processedWebhookIds).toEqual(['event-b', 'event-a']);
  });

  it('exposes truthful access at the trial boundary', () => {
    const trial = startTrialAfterFirstUsableImport(inactive(), true, new Date('2026-01-01T00:00:00Z'));
    expect(resolveEntitlementAccess(trial, new Date('2026-01-14T23:59:59Z'))).toMatchObject({ allowed: true, reason: 'trialing' });
    expect(resolveEntitlementAccess(trial, new Date('2026-01-15T00:00:00Z'))).toMatchObject({ allowed: false, reason: 'trial_expired' });
  });

  it.each(['past_due', 'canceled', 'inactive'] as const)('denies paid features for %s billing state', (status) => {
    expect(resolveEntitlementAccess({ ...inactive(), status }, new Date('2026-01-01T00:00:00Z'))).toMatchObject({ allowed: false, reason: status, status });
  });
});
