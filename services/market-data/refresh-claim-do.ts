import type { RefreshClaimStore } from '@/services/market-data/scheduled-refresh';

type ClaimState = { expiresAt: number };
type StateLike = { storage: { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void>; delete(key: string): Promise<boolean> } };
type NamespaceLike = { idFromName(name: string): unknown; get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

/** Durable, per-key claim used to prevent duplicate EOD provider calls. */
export class RefreshClaimDurableObject {
  constructor(private readonly state: StateLike) {}
  async fetch(request: Request): Promise<Response> {
    const key = 'claim';
    if (request.method === 'POST') {
      const input = await request.json().catch(() => undefined) as { now?: unknown; ttlMs?: unknown } | undefined;
      if (typeof input?.now !== 'number' || typeof input.ttlMs !== 'number' || !Number.isSafeInteger(input.now) || !Number.isSafeInteger(input.ttlMs) || input.now < 0 || input.ttlMs < 1) return Response.json({ error: 'invalid_claim_input' }, { status: 400 });
      const current = await this.state.storage.get<ClaimState>(key);
      if (current && current.expiresAt > input.now) return Response.json({ claimed: false });
      await this.state.storage.put(key, { expiresAt: input.now + input.ttlMs });
      return Response.json({ claimed: true });
    }
    if (request.method === 'DELETE') { await this.state.storage.delete(key); return Response.json({ released: true }); }
    return new Response('Method not allowed.', { status: 405 });
  }
}

export class CloudflareDurableObjectRefreshClaimStore implements RefreshClaimStore {
  constructor(private readonly namespace: NamespaceLike, private readonly ttlMs = 15 * 60_000, private readonly now = () => Date.now()) {}
  async tryClaim(key: string): Promise<boolean> {
    const response = await this.namespace.get(this.namespace.idFromName(key)).fetch('https://refresh-claim/claim', { method: 'POST', body: JSON.stringify({ now: this.now(), ttlMs: this.ttlMs }), headers: { 'content-type': 'application/json' } });
    if (!response.ok) throw new Error(`Refresh claim failed with HTTP ${response.status}.`);
    const payload = await response.json() as { claimed?: unknown };
    if (typeof payload.claimed !== 'boolean') throw new Error('Refresh claim returned an invalid result.');
    return payload.claimed;
  }
  async release(key: string): Promise<void> {
    const response = await this.namespace.get(this.namespace.idFromName(key)).fetch('https://refresh-claim/claim', { method: 'DELETE' });
    if (!response.ok) throw new Error(`Refresh claim release failed with HTTP ${response.status}.`);
  }
}
