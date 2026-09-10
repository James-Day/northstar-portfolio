import { z } from 'zod';
import { parseOpeningHistory, type OpeningHistory } from '@/services/accounts/opening-history';
import type { OpeningHistoryRepository } from '@/services/accounts/opening-history-repository';

const rowSchema = z.object({ account_id: z.string().uuid(), opening_cash: z.string(), activity_covered_from: z.string().nullable(), incomplete_reason: z.string().nullable(), positions: z.unknown() });

export class SupabaseOpeningHistoryRepository implements OpeningHistoryRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { supabaseUrl: string; supabaseAnonKey: string; fetcher?: typeof fetch }) {
    this.baseUrl = new URL(options.supabaseUrl);
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  async get(accountId: string, userId: string, accessToken: string): Promise<OpeningHistory | undefined> {
    const url = new URL('/rest/v1/account_opening_history', this.baseUrl);
    url.searchParams.set('account_id', `eq.${accountId}`);
    url.searchParams.set('select', 'account_id,opening_cash,activity_covered_from,incomplete_reason,positions');
    url.searchParams.set('limit', '1');
    const response = await this.fetcher(url, { headers: this.headers(accessToken) });
    if (!response.ok) throw new Error(`Supabase opening history query failed with HTTP ${response.status}.`);
    const row = z.array(rowSchema).parse(await response.json())[0];
    if (!row) return undefined;
    const account = await this.assertOwner(accountId, userId, accessToken);
    if (!account) return undefined;
    return parseOpeningHistory({ openingCash: row.opening_cash, activityCoveredFrom: row.activity_covered_from, incompleteReason: row.incomplete_reason, positions: row.positions });
  }
  async save(accountId: string, userId: string, accessToken: string, history: OpeningHistory): Promise<OpeningHistory> {
    const validated = parseOpeningHistory(history);
    if (!await this.assertOwner(accountId, userId, accessToken)) throw new Error('Account not found.');
    const url = new URL('/rest/v1/account_opening_history', this.baseUrl);
    const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(accessToken), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ account_id: accountId, opening_cash: validated.openingCash, activity_covered_from: validated.activityCoveredFrom, incomplete_reason: validated.incompleteReason, positions: validated.positions }) });
    if (!response.ok) throw new Error(`Supabase opening history save failed with HTTP ${response.status}.`);
    const row = z.array(rowSchema).parse(await response.json())[0];
    if (!row) throw new Error('Supabase opening history save returned no record.');
    return parseOpeningHistory({ openingCash: row.opening_cash, activityCoveredFrom: row.activity_covered_from, incompleteReason: row.incomplete_reason, positions: row.positions });
  }
  private async assertOwner(accountId: string, userId: string, accessToken: string) {
    const url = new URL('/rest/v1/accounts', this.baseUrl); url.searchParams.set('id', `eq.${accountId}`); url.searchParams.set('select', 'id,user_id');
    const response = await this.fetcher(url, { headers: this.headers(accessToken) });
    if (!response.ok) throw new Error(`Supabase account ownership query failed with HTTP ${response.status}.`);
    const rows = z.array(z.object({ id: z.string().uuid(), user_id: z.string().uuid() })).parse(await response.json());
    return rows[0]?.user_id === userId;
  }
  private headers(accessToken: string) { return { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` }; }
}
