import { SupabasePrivateObjectStore } from '@/services/supabase/raw-file-retention-repository';
import type { DeletionSideEffects } from '@/services/privacy/deletion-executor';

export type SupabaseDeletionEffectsOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  storageBucket?: string;
  cancelBillingCustomer: (userId: string, customerId: string | null) => Promise<void>;
};

/** Service-role side effects for the durable deletion executor.
 * Account cleanup is one transaction behind a restricted RPC; provider
 * operations remain injected so billing cancellation cannot be skipped. */
export class SupabaseDeletionEffects implements DeletionSideEffects {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly storage: SupabasePrivateObjectStore;

  constructor(private readonly options: SupabaseDeletionEffectsOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for deletion effects.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.storage = new SupabasePrivateObjectStore({ supabaseUrl: options.supabaseUrl, serviceRoleKey: options.serviceRoleKey, fetcher: this.fetcher, bucket: options.storageBucket });
  }

  private headers() { return { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}`, 'content-type': 'application/json' }; }
  private async rpc(name: string, body: Record<string, unknown>): Promise<void> {
    const response = await this.fetcher(new URL(`/rest/v1/rpc/${name}`, this.baseUrl), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase deletion RPC ${name} failed with HTTP ${response.status}.`);
  }
  private async deleteRows(table: string, filter: string): Promise<void> {
    const url = new URL(`/rest/v1/${table}`, this.baseUrl);
    url.searchParams.set(filter.split('=')[0], filter.split('=')[1]);
    const response = await this.fetcher(url, { method: 'DELETE', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` } });
    if (!response.ok && response.status !== 404) throw new Error(`Supabase deletion of ${table} failed with HTTP ${response.status}.`);
  }

  deletePrivateObject(path: string): Promise<void> { return this.storage.delete(path); }
  deleteAccount(userId: string, accountId: string): Promise<void> { return this.rpc('delete_user_account_data', { p_user_id: userId, p_account_id: accountId }); }
  deleteReportSnapshots(userId: string): Promise<void> { return this.deleteRows('report_snapshots', `user_id=eq.${userId}`); }
  deleteProfile(userId: string): Promise<void> { return this.deleteRows('profiles', `id=eq.${userId}`); }
  cancelBillingCustomer(userId: string, customerId: string | null): Promise<void> { return this.options.cancelBillingCustomer(userId, customerId); }

  async deleteAuthUser(userId: string): Promise<void> {
    const response = await this.fetcher(new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, this.baseUrl), { method: 'DELETE', headers: { apikey: this.options.serviceRoleKey, authorization: `Bearer ${this.options.serviceRoleKey}` } });
    if (!response.ok && response.status !== 404) throw new Error(`Supabase Auth user deletion failed with HTTP ${response.status}.`);
  }
}
