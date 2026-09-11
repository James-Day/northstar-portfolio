import { describe, expect, it, vi } from 'vitest';
import { CloudflareDurableObjectRefreshClaimStore, RefreshClaimDurableObject } from './refresh-claim-do';

describe('Durable refresh claims', () => {
  it('claims once until release or expiry', async () => {
    const values = new Map<string, unknown>();
    const object = new RefreshClaimDurableObject({ storage: { get: async <T>(key: string) => values.get(key) as T | undefined, put: async (key: string, value: unknown) => void values.set(key, value), delete: async (key: string) => values.delete(key) } });
    const request = () => new Request('https://claim', { method: 'POST', body: JSON.stringify({ now: 1_000, ttlMs: 60_000 }) });
    await expect((await object.fetch(request())).json()).resolves.toEqual({ claimed: true });
    await expect((await object.fetch(request())).json()).resolves.toEqual({ claimed: false });
    await expect((await object.fetch(new Request('https://claim', { method: 'DELETE' }))).json()).resolves.toEqual({ released: true });
  });

  it('uses a deterministic Durable Object namespace key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ claimed: true }), { status: 200 }));
    const idFromName = vi.fn().mockReturnValue('id');
    const store = new CloudflareDurableObjectRefreshClaimStore({ idFromName, get: vi.fn().mockReturnValue({ fetch }) }, 1000, () => 5000);
    await expect(store.tryClaim('daily-refresh:date:AAPL')).resolves.toBe(true);
    await store.release('daily-refresh:date:AAPL');
    expect(idFromName).toHaveBeenCalledWith('daily-refresh:date:AAPL');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
