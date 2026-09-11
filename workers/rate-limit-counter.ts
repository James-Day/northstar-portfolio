import type { AtomicRateLimitCounterStore } from '@/services/security/request-security';

type CounterState = { windowStartedAt: number; count: number };
type DurableObjectStateLike = { storage: { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> } };
type DurableObjectNamespaceLike = { idFromName(name: string): unknown; get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

/** Single-key serialized counter suitable for a Cloudflare Durable Object. */
export class RateLimitCounterDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405 });
    const input = await request.json().catch(() => undefined) as { now?: unknown; windowMs?: unknown } | undefined;
    const now = input?.now;
    const windowMs = input?.windowMs;
    if (typeof now !== 'number' || typeof windowMs !== 'number' || !Number.isSafeInteger(now) || !Number.isSafeInteger(windowMs) || now < 0 || windowMs < 1) return Response.json({ error: 'invalid_counter_input' }, { status: 400 });
    const current = await this.state.storage.get<CounterState>('counter');
    const counter = !current || now - current.windowStartedAt >= windowMs ? { windowStartedAt: now, count: 1 } : { windowStartedAt: current.windowStartedAt, count: current.count + 1 };
    await this.state.storage.put('counter', counter);
    return Response.json(counter);
  }
}

/** Shared limiter store backed by one Durable Object instance per bucket key. */
export class CloudflareDurableObjectCounterStore implements AtomicRateLimitCounterStore {
  constructor(private readonly namespace: DurableObjectNamespaceLike) {}

  async increment(key: string, now: number, windowMs: number): Promise<CounterState> {
    const id = this.namespace.idFromName(key);
    const response = await this.namespace.get(id).fetch('https://rate-limit-counter/increment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ now, windowMs }) });
    if (!response.ok) throw new Error(`Rate-limit counter failed with HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !Number.isSafeInteger((payload as CounterState).windowStartedAt) || !Number.isSafeInteger((payload as CounterState).count)) throw new Error('Rate-limit counter returned an invalid state.');
    return payload as CounterState;
  }
}
