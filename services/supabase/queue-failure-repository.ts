import { z } from 'zod';
import type { QueueFailureRecorder, QueueReplayRepository } from '@/services/queues/failure-evidence';

export class SupabaseQueueFailureRepository implements QueueFailureRecorder, QueueReplayRepository {
  private readonly baseUrl: URL; private readonly fetcher: typeof fetch;
  constructor(private readonly options: { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch }) { this.baseUrl = new URL(options.supabaseUrl); if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for queue failure evidence.'); this.fetcher = options.fetcher ?? fetch; }
  async record(input: { queueName?: string; payload: unknown; reason: string; attempts?: number }): Promise<void> { await this.rpc('record_queue_rejection', { p_queue_name: input.queueName ?? 'unknown', p_payload: input.payload, p_reason: input.reason, p_attempts: input.attempts ?? 0 }); }
  async replay(id: string) { const result = await this.rpc('replay_queue_rejection', { p_id: id }); return result === null ? undefined : z.record(z.string(), z.unknown()).parse(result) as never; }
  private async rpc(name: string, body: Record<string, unknown>): Promise<unknown> { const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Supabase ${name} failed with HTTP ${response.status}.`); return response.json(); }
}
