import { z } from 'zod';

export type DeletionRequestRecord = {
  id: string;
  userId: string;
  status: 'requested' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  completedAt: string | null;
};

const rowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(['requested', 'processing', 'completed', 'failed']),
  requested_at: z.string(),
  completed_at: z.string().nullable(),
});

const responseSchema = z.array(rowSchema);

export type DeletionRequestRepositoryOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  fetcher?: typeof fetch;
};

/**
 * Creates an authenticated deletion request through a security-definer RPC.
 * The RPC owns idempotency and cleanup-plan creation; this adapter never
 * attempts irreversible deletion itself.
 */
export class SupabaseDeletionRequestRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: DeletionRequestRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for deletion requests.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async request(userId: string, accessToken: string): Promise<DeletionRequestRecord> {
    if (!userId.trim()) throw new Error('Deletion request requires a user ID.');
    if (!accessToken.trim()) throw new Error('Deletion request requires an access token.');
    const response = await this.fetcher(new URL('/rest/v1/rpc/request_user_data_deletion', this.baseUrl), {
      method: 'POST',
      headers: { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Supabase deletion request failed with HTTP ${response.status}.`);
    const rows = responseSchema.parse(await response.json());
    if (rows.length !== 1) throw new Error('Supabase deletion request returned an unexpected result.');
    if (rows[0].user_id !== userId) throw new Error('Supabase returned a deletion request for another user.');
    return {
      id: rows[0].id,
      userId: rows[0].user_id,
      status: rows[0].status,
      requestedAt: rows[0].requested_at,
      completedAt: rows[0].completed_at,
    };
  }
}
