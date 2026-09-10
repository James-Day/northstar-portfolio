import { z } from 'zod';
import { reconcilePersistedTransfers, type PersistedTransferRow, type TransferReconciliation } from '@/services/ledger/persisted-transfers';
import type { InstrumentAlias } from '@/lib/domain/types';

const transferRowSchema = z.object({ id: z.string().uuid(), account_id: z.string().uuid(), effective_date: z.string(), entry_type: z.enum(['transfer_in', 'transfer_out']), internal_transfer_group: z.string().uuid().nullable(), instrument_id: z.string().uuid().nullable(), quantity: z.string().nullable(), cash_amount: z.string() });
const aliasSchema = z.object({ instrument_id: z.string().uuid(), symbol: z.string(), effective_from: z.string(), effective_to: z.string().nullable() });

export type SupabaseInternalTransfersRepositoryOptions = { supabaseUrl: string; supabaseAnonKey: string; fetcher?: typeof fetch };

/** Reads all owned account transfer rows and persists the deterministic reconciliation result. */
export class SupabaseInternalTransfersRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: SupabaseInternalTransfersRepositoryOptions) { this.baseUrl = new URL(options.supabaseUrl); this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init)); }

  async reconcile(userId: string, accessToken: string): Promise<TransferReconciliation> {
    const accountsUrl = new URL('/rest/v1/accounts', this.baseUrl);
    accountsUrl.searchParams.set('select', 'id');
    accountsUrl.searchParams.set('user_id', `eq.${userId}`);
    const accountsResponse = await this.fetcher(accountsUrl, { headers: this.headers(accessToken) });
    if (!accountsResponse.ok) throw new Error(`Supabase account query failed with HTTP ${accountsResponse.status}.`);
    const accountIds = z.array(z.object({ id: z.string().uuid() })).parse(await accountsResponse.json()).map((account) => account.id);
    if (!accountIds.length) return { transfers: [], linked: [], unresolved: [] };

    const ledgerUrl = new URL('/rest/v1/ledger_entries', this.baseUrl);
    ledgerUrl.searchParams.set('select', 'id,account_id,effective_date,entry_type,internal_transfer_group,instrument_id,quantity,cash_amount');
    ledgerUrl.searchParams.set('account_id', `in.(${accountIds.join(',')})`);
    ledgerUrl.searchParams.set('entry_type', 'in.(transfer_in,transfer_out)');
    const ledgerResponse = await this.fetcher(ledgerUrl, { headers: this.headers(accessToken) });
    if (!ledgerResponse.ok) throw new Error(`Supabase transfer query failed with HTTP ${ledgerResponse.status}.`);
    const rows = z.array(transferRowSchema).parse(await ledgerResponse.json());
    const aliasesUrl = new URL('/rest/v1/instrument_aliases', this.baseUrl);
    aliasesUrl.searchParams.set('select', 'instrument_id,symbol,effective_from,effective_to');
    const aliasesResponse = await this.fetcher(aliasesUrl, { headers: this.headers(accessToken) });
    if (!aliasesResponse.ok) throw new Error(`Supabase instrument alias query failed with HTTP ${aliasesResponse.status}.`);
    const aliases: InstrumentAlias[] = z.array(aliasSchema).parse(await aliasesResponse.json()).map((alias) => ({ instrumentId: alias.instrument_id as never, symbol: alias.symbol, effectiveFrom: alias.effective_from as never, effectiveTo: alias.effective_to as never }));
    const result = reconcilePersistedTransfers(rows.map((row): PersistedTransferRow => ({ id: row.id, accountId: row.account_id, effectiveDate: row.effective_date, entryType: row.entry_type, transferGroupId: row.internal_transfer_group, instrumentId: row.instrument_id, symbol: null, quantity: row.quantity, cashAmount: row.cash_amount })), aliases);
    const reconciliationUrl = new URL('/rest/v1/internal_transfer_reconciliations', this.baseUrl);
    await this.persist(reconciliationUrl, userId, result, accessToken);
    return result;
  }

  private async persist(url: URL, userId: string, result: TransferReconciliation, accessToken: string) {
    const linkedByGroup = new Map(result.linked.map((item) => [item.transferGroupId, item]));
    const unresolvedByGroup = new Map(result.unresolved.map((item) => [item.transferGroupId, item]));
    // Ungrouped entries use a readable synthetic key in the domain result;
    // they cannot be written to the UUID-backed durable table, but remain
    // visible to the caller as unresolved.
    const groups = new Set([...linkedByGroup.keys(), ...unresolvedByGroup.keys()].filter((group) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(group)));
    if (!groups.size) return;
    const body = [...groups].map((transferGroupId) => {
      const linked = linkedByGroup.get(transferGroupId);
      const unresolved = unresolvedByGroup.get(transferGroupId);
      return { user_id: userId, transfer_group_id: transferGroupId, status: linked ? 'linked' : 'unresolved', incoming_entry_id: linked?.incomingId ?? null, outgoing_entry_id: linked?.outgoingId ?? null, unresolved_ids: unresolved?.ids ?? [], reason: unresolved?.reason ?? null };
    });
    const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(accessToken), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase transfer reconciliation save failed with HTTP ${response.status}.`);
  }
  private headers(accessToken: string) { return { apikey: this.options.supabaseAnonKey, authorization: `Bearer ${accessToken}` }; }
}
