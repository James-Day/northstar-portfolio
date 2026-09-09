import { z } from 'zod';
import type { AccountsRepository, CreatePortfolioAccountInput, PortfolioAccount } from '@/services/accounts/accounts';

const accountRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  brokerage: z.literal('robinhood'),
  account_type: z.enum(['individual', 'traditional_ira', 'roth_ira']),
  name: z.string(),
  currency: z.literal('USD'),
  activity_covered_through: z.string().nullable(),
  created_at: z.string(),
});

export type SupabaseAccountsRepositoryOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  fetcher?: typeof fetch;
};

/** Uses the caller's bearer token, so Supabase RLS remains the ownership authority. */
export class SupabaseAccountsRepository implements AccountsRepository {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly options: SupabaseAccountsRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim()) throw new Error('SUPABASE_ANON_KEY is required for account queries.');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async list(userId: string, accessToken: string): Promise<PortfolioAccount[]> {
    const url = new URL('/rest/v1/accounts', this.baseUrl);
    url.searchParams.set('select', 'id,user_id,brokerage,account_type,name,currency,activity_covered_through,created_at');
    url.searchParams.set('order', 'created_at.asc');
    const response = await this.fetcher(url, { headers: this.headers(accessToken) });
    if (!response.ok) throw new Error(`Supabase accounts query failed with HTTP ${response.status}.`);
    const rows = z.array(accountRowSchema).parse(await response.json());
    return rows.map((row) => mapAccount(row, userId));
  }

  async get(userId: string, accessToken: string, accountId: string): Promise<PortfolioAccount | undefined> {
    const url = new URL('/rest/v1/accounts', this.baseUrl);
    url.searchParams.set('id', `eq.${accountId}`);
    url.searchParams.set('select', 'id,user_id,brokerage,account_type,name,currency,activity_covered_through,created_at');
    url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: this.headers(accessToken) });
    if (!response.ok) throw new Error(`Supabase account query failed with HTTP ${response.status}.`);
    const rows = z.array(accountRowSchema).parse(await response.json());
    return rows[0] ? mapAccount(rows[0], userId) : undefined;
  }

  async create(userId: string, accessToken: string, input: CreatePortfolioAccountInput): Promise<PortfolioAccount> {
    const url = new URL('/rest/v1/accounts', this.baseUrl);
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { ...this.headers(accessToken), 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, brokerage: 'robinhood', account_type: input.accountType, name: input.name, currency: 'USD' }),
    });
    if (!response.ok) throw new Error(`Supabase account creation failed with HTTP ${response.status}.`);
    const rows = z.array(accountRowSchema).parse(await response.json());
    if (rows.length !== 1) throw new Error('Supabase account creation returned an unexpected result.');
    return mapAccount(rows[0], userId);
  }

  private headers(accessToken: string) {
    return { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` };
  }
}

function mapAccount(row: z.infer<typeof accountRowSchema>, expectedUserId: string): PortfolioAccount {
  if (row.user_id !== expectedUserId) throw new Error('Supabase returned an account for another user.');
  return {
    id: row.id,
    userId: row.user_id,
    brokerage: row.brokerage,
    accountType: row.account_type,
    name: row.name,
    currency: row.currency,
    activityCoveredThrough: row.activity_covered_through,
    createdAt: row.created_at,
  };
}
