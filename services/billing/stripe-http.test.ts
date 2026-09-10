import { describe, expect, it } from 'vitest';
import { verifyStripeWebhook, StripeSignatureError } from '@/services/billing/stripe-http';

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
