import { describe, expect, it } from 'vitest';
import { verifyStripeWebhook, StripeSignatureError, validateStripeBillingConfiguration, BillingConfigurationError } from '@/services/billing/stripe-http';

async function sign(secret: string, body: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${digest}`;
}

describe('Stripe HTTP webhook boundary', () => {
  it('verifies the raw body and returns the signed event', async () => {
    const body = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.updated', created: 1_767_000_000, data: { object: { id: 'sub_123' } } });
    const signature = await sign('whsec_test', body, 1_767_000_000);
    await expect(verifyStripeWebhook(body, signature, 'whsec_test', { now: new Date('2026-01-01T00:00:00Z'), toleranceSeconds: 100_000_000 })).resolves.toMatchObject({ id: 'evt_123', type: 'customer.subscription.updated', created: 1_767_000_000 });
  });

  it('rejects altered bodies, missing signatures and stale timestamps', async () => {
    const body = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.updated', created: 1_767_000_000, data: {} });
    const signature = await sign('whsec_test', body, 1_767_000_000);
    await expect(verifyStripeWebhook(`${body} `, signature, 'whsec_test', { now: new Date('2026-01-01T00:00:00Z'), toleranceSeconds: 100_000_000 })).rejects.toBeInstanceOf(StripeSignatureError);
    await expect(verifyStripeWebhook(body, undefined, 'whsec_test')).rejects.toBeInstanceOf(StripeSignatureError);
    await expect(verifyStripeWebhook(body, signature, 'whsec_test', { now: new Date('2027-01-01T00:00:00Z') })).rejects.toBeInstanceOf(StripeSignatureError);
  });

  it('accepts one of multiple v1 signatures for secret rotation', async () => {
    const body = JSON.stringify({ id: 'evt_rotate', type: 'customer.subscription.deleted', created: 1_767_000_000, data: {} });
    const signature = await sign('whsec_current', body, 1_767_000_000);
    await expect(verifyStripeWebhook(body, `${signature},v1=deadbeef`, 'whsec_current', { now: new Date('2026-01-01T00:00:00Z'), toleranceSeconds: 100_000_000 })).resolves.toMatchObject({ id: 'evt_rotate' });
  });
});

describe('Stripe billing configuration contract', () => {
  const valid = {
    monthlyPriceId: 'price_monthlytest',
    annualPriceId: 'price_annualtest',
    monthlyPriceCents: '500',
    annualPriceCents: '4900',
  };

  it('accepts the distinct $5 monthly and $49 annual server configuration', () => {
    expect(validateStripeBillingConfiguration(valid, { requireAmounts: true })).toEqual({
      monthlyPriceId: 'price_monthlytest',
      annualPriceId: 'price_annualtest',
    });
  });

  it.each([
    ['the same price for both plans', { monthlyPriceId: 'price_same', annualPriceId: 'price_same' }],
    ['a client-shaped or malformed monthly identifier', { monthlyPriceId: 'monthly', annualPriceId: valid.annualPriceId }],
    ['a missing annual identifier', { monthlyPriceId: valid.monthlyPriceId, annualPriceId: undefined }],
    ['a partial amount recording', { ...valid, annualPriceCents: undefined }],
    ['a wrong amount', { ...valid, annualPriceCents: '4999' }],
  ])('rejects %s before any Stripe request', (_label, overrides) => {
    expect(() => validateStripeBillingConfiguration({ ...valid, ...overrides }, { requireAmounts: true })).toThrow(BillingConfigurationError);
  });

  it('allows staging to omit amounts while rejecting any incomplete amount pair', () => {
    expect(validateStripeBillingConfiguration({ monthlyPriceId: valid.monthlyPriceId, annualPriceId: valid.annualPriceId })).toEqual({
      monthlyPriceId: valid.monthlyPriceId,
      annualPriceId: valid.annualPriceId,
    });
    expect(() => validateStripeBillingConfiguration({ ...valid, monthlyPriceCents: undefined })).toThrow(BillingConfigurationError);
  });
});
