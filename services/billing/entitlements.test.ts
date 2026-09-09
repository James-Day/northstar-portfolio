import { describe, expect, it } from 'vitest';
import { applyBillingWebhook, startTrialAfterFirstUsableImport, type Entitlement } from '@/services/billing/entitlements';

const inactive = (): Entitlement => ({ status: 'inactive', trialStartedAt: null, trialEndsAt: null, processedWebhookIds: [] });

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
    const first = applyBillingWebhook(inactive(), { id: 'event-1', type: 'subscription_active' });
    expect(applyBillingWebhook(first, { id: 'event-1', type: 'subscription_canceled' })).toBe(first);
  });
});
