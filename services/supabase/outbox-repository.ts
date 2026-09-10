import { z } from 'zod';
import type { OutboxRecord, OutboxRepository } from '@/services/queues/outbox-dispatcher';

const rowSchema = z.object({ id: z.string().uuid(), event_type: z.string(), payload: z.unknown(), attempts: z.number().int().nonnegative() });
const statusSchema = z.enum(['retrying', 'failed', 'missing']);
export type SupabaseOutboxRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

/** Service-role repository for the worker-only outbox RPCs. */
export class SupabaseOutboxRepository implements OutboxRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: SupabaseOutboxRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for outbox workers.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }; }
  private async rpc(name: string, body: Record<string, unknown>) {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase outbox RPC ${name} failed with HTTP ${response.status}.`);
    return response;
  }
  async claim(limit: number, now: string): Promise<OutboxRecord[]> {
    const response = await this.rpc('claim_job_outbox', { p_limit: limit, p_now: now });
    return z.array(rowSchema).parse(await response.json()).map((row) => ({ id: row.id, eventType: row.event_type, payload: row.payload, attempts: row.attempts }));
  }
  async complete(id: string): Promise<void> { await this.rpc('complete_job_outbox', { p_id: id }); }
  async fail(id: string, input: { retryAt: string; error: string; maxAttempts: number }): Promise<'retrying' | 'failed'> {
    const response = await this.rpc('fail_job_outbox', { p_id: id, p_available_at: input.retryAt, p_error: input.error, p_max_attempts: input.maxAttempts });
    const status = statusSchema.parse(await response.json());
    return status === 'missing' ? 'failed' : status;
  }
  async resolveAccountOwner(accountId: string): Promise<string | undefined> {
    const url = new URL('/rest/v1/accounts', this.baseUrl);
    url.searchParams.set('id', `eq.${accountId}`); url.searchParams.set('select', 'user_id'); url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` } });
    if (!response.ok) throw new Error(`Supabase account ownership lookup failed with HTTP ${response.status}.`);
    const rows = z.array(z.object({ user_id: z.string().uuid() })).parse(await response.json());
    return rows[0]?.user_id;
  }
}
