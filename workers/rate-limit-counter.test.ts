import { describe, expect, it, vi } from 'vitest';
import { CloudflareDurableObjectCounterStore, RateLimitCounterDurableObject } from './rate-limit-counter';

describe('Durable Object rate-limit counter', () => {
  it('increments and resets a bucket at the window boundary', async () => {
    const values = new Map<string, unknown>();
    const object = new RateLimitCounterDurableObject({ storage: { get: async <T>(key: string) => values.get(key) as T | undefined, put: async (key: string, value: unknown) => void values.set(key, value) } });
    await expect((await object.fetch(new Request('https://counter', { method: 'POST', body: JSON.stringify({ now: 1000, windowMs: 60_000 }) }))).json()).resolves.toEqual({ windowStartedAt: 1000, count: 1 });
    await expect((await object.fetch(new Request('https://counter', { method: 'POST', body: JSON.stringify({ now: 60_999, windowMs: 60_000 }) }))).json()).resolves.toEqual({ windowStartedAt: 1000, count: 2 });
    await expect((await object.fetch(new Request('https://counter', { method: 'POST', body: JSON.stringify({ now: 61_000, windowMs: 60_000 }) }))).json()).resolves.toEqual({ windowStartedAt: 61_000, count: 1 });
  });

  it('routes a shared increment to the named Durable Object', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ windowStartedAt: 1_000, count: 2 }), { status: 200 }));
    const idFromName = vi.fn().mockReturnValue('id');
    const store = new CloudflareDurableObjectCounterStore({ idFromName, get: vi.fn().mockReturnValue({ fetch }) });
    await expect(store.increment('ip:read', 1_500, 60_000)).resolves.toEqual({ windowStartedAt: 1_000, count: 2 });
    expect(idFromName).toHaveBeenCalledWith('ip:read');
    expect(fetch).toHaveBeenCalledWith('https://rate-limit-counter/increment', expect.objectContaining({ method: 'POST' }));
  });
});
