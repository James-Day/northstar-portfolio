import { z } from 'zod';
import type { RetentionCandidate, RetentionClaimRepository, PrivateObjectStore } from '@/services/privacy/retention-executor';

const candidateSchema = z.object({ id: z.string().uuid(), import_id: z.string().uuid(), object_path: z.string().min(1), uploaded_at: z.string().datetime(), deleted_at: z.string().datetime().nullable(), attempts: z.number().int().positive() });
const outcomeSchema = z.enum(['retrying', 'exhausted']);

type Options = { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch; bucket?: string };

function safePath(path: string): string {
  if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/u.test(path)) throw new Error('Storage object path is invalid.');
  return path;
}

/** Worker-only persistence for retention claims and audit state. */
export class SupabaseRawFileRetentionRepository implements RetentionClaimRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: Options) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for retention workers.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }; }
  private async rpc(name: string, body: Record<string, unknown>): Promise<Response> {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase retention RPC ${name} failed with HTTP ${response.status}.`);
    return response;
  }
  async claim(now: Date, limit: number, maxAttempts: number): Promise<RetentionCandidate[]> {
    const rows = z.array(candidateSchema).parse(await (await this.rpc('claim_raw_file_retention', { p_limit: limit, p_now: now.toISOString(), p_max_attempts: maxAttempts })).json());
    return rows.map((row) => ({ id: row.id, importId: row.import_id, objectPath: safePath(row.object_path), uploadedAt: new Date(row.uploaded_at), deletedAt: row.deleted_at ? new Date(row.deleted_at) : null, attempt: row.attempts }));
  }
  async markDeleted(id: string, at: Date): Promise<void> { await this.rpc('complete_raw_file_retention', { p_id: id, p_deleted_at: at.toISOString() }); }
  async markFailure(id: string, input: { at: Date; retryAt: Date; error: string; maxAttempts: number }): Promise<'retrying' | 'exhausted'> {
    return outcomeSchema.parse(await (await this.rpc('fail_raw_file_retention', { p_id: id, p_failed_at: input.at.toISOString(), p_available_at: input.retryAt.toISOString(), p_error: input.error, p_max_attempts: input.maxAttempts })).json());
  }
}

/** Service-role adapter for the private brokerage-statements bucket. */
export class SupabasePrivateObjectStore implements PrivateObjectStore {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly bucket: string;
  constructor(private readonly options: Options) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for private object retention.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.bucket = options.bucket ?? 'brokerage-statements';
  }
  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` }; }
  async delete(path: string): Promise<void> {
    const safe = safePath(path);
    const response = await this.fetcher(new URL(`/storage/v1/object/remove/${encodeURIComponent(this.bucket)}`, this.baseUrl), { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json' }, body: JSON.stringify([safe]) });
    if (response.status === 404) return; // Idempotent if an earlier attempt removed it.
    if (!response.ok) throw new Error(`Supabase private object delete failed with HTTP ${response.status}.`);
  }
  async verifyDeleted(path: string): Promise<boolean> {
    const safe = safePath(path);
    const response = await this.fetcher(new URL(`/storage/v1/object/${encodeURIComponent(this.bucket)}/${safe.split('/').map(encodeURIComponent).join('/')}`, this.baseUrl), { method: 'HEAD', headers: this.headers() });
    if (response.status === 404) return true;
    if (!response.ok) throw new Error(`Supabase private object verification failed with HTTP ${response.status}.`);
    return false;
  }
}
