import { z } from 'zod';
import type { DeletionPlanItem, DeletionPlanRepository } from '@/services/privacy/deletion-executor';

const itemSchema = z.object({ id: z.string().uuid(), request_id: z.string().uuid(), user_id: z.string().uuid(), target_type: z.enum(['raw_object', 'account', 'report_snapshots', 'profile', 'billing_customer', 'auth_user']), target_id: z.string().uuid().nullable(), target_path: z.string().nullable(), attempts: z.number().int().positive() });

export type SupabaseDeletionExecutorRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch };

export class SupabaseDeletionExecutorRepository implements DeletionPlanRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: SupabaseDeletionExecutorRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for deletion workers.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  private async rpc(name: string, body: Record<string, unknown>): Promise<Response> {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase deletion RPC ${name} failed with HTTP ${response.status}.`);
    return response;
  }
  async claim(limit: number, now: Date, maxAttempts: number): Promise<DeletionPlanItem[]> {
    const rows = z.array(itemSchema).parse(await (await this.rpc('claim_user_deletion_plan_items', { p_limit: limit, p_now: now.toISOString(), p_max_attempts: maxAttempts })).json());
    return rows.map((row) => ({ id: row.id, requestId: row.request_id, userId: row.user_id, targetType: row.target_type, targetId: row.target_id, targetPath: row.target_path, attempt: row.attempts }));
  }
  async complete(id: string, at: Date, attempt?: number): Promise<void> { await this.rpc('complete_user_deletion_plan_item', { p_id: id, p_completed_at: at.toISOString(), ...(attempt === undefined ? {} : { p_attempts: attempt }) }); }
  async fail(id: string, input: { failedAt: Date; retryAt: Date; error: string; maxAttempts: number; attempt?: number }): Promise<'retrying' | 'exhausted' | 'ignored'> {
    const rows = z.array(z.object({ outcome: z.enum(['retrying', 'exhausted', 'ignored']) })).parse(await (await this.rpc('fail_user_deletion_plan_item', { p_id: id, p_failed_at: input.failedAt.toISOString(), p_available_at: input.retryAt.toISOString(), p_error: input.error, p_max_attempts: input.maxAttempts, ...(input.attempt === undefined ? {} : { p_attempts: input.attempt }) })).json());
    if (rows.length !== 1) throw new Error('Supabase deletion failure RPC returned an unexpected result.');
    return rows[0].outcome;
  }
}
