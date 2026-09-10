import { z } from 'zod';
import type { ImportJobRepository, ImportProcessingLease } from '@/services/queues/import-worker';
import type { QueueJob } from '@/services/queues/contracts';

const leaseSchema = z.object({ import_id: z.string().uuid(), account_id: z.string().uuid(), attempt: z.number().int().positive(), total_rows: z.number().int().nonnegative(), progress_rows: z.number().int().nonnegative() });
const stateSchema = z.object({ state: z.literal('already_complete') });

/** Service-role repository for the import consumer. All state changes are SQL
 * functions so claim/progress/failure updates remain atomic under retries. */
export class SupabaseImportJobRepository implements ImportJobRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch }) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for import worker writes.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  async claim(job: Extract<QueueJob, { kind: 'import.process' }>): Promise<ImportProcessingLease | { state: 'already_complete' } | undefined> {
    const result = await this.rpc('claim_import_processing', { p_import_id: job.importId, p_account_id: job.accountId, p_requested_by: job.requestedBy });
    if (result === null) return undefined;
    const state = stateSchema.safeParse(result);
    if (state.success) return state.data;
    const lease = leaseSchema.parse(result);
    return { importId: lease.import_id, accountId: lease.account_id, attempt: lease.attempt, totalRows: lease.total_rows, progressRows: lease.progress_rows };
  }
  async progress(lease: ImportProcessingLease, progressRows: number): Promise<void> {
    await this.rpc('advance_import_processing', { p_import_id: lease.importId, p_account_id: lease.accountId, p_progress_rows: progressRows });
  }
  async complete(lease: ImportProcessingLease): Promise<void> {
    await this.rpc('complete_import_processing', { p_import_id: lease.importId, p_account_id: lease.accountId });
  }
  async fail(lease: ImportProcessingLease, error: string): Promise<'retrying' | 'dead_lettered'> {
    const result = await this.rpc('fail_import_processing', { p_import_id: lease.importId, p_account_id: lease.accountId, p_error: error });
    return z.enum(['retrying', 'dead_lettered']).parse(result);
  }
  private async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase ${name} failed with HTTP ${response.status}.`);
    return response.json();
  }
}
