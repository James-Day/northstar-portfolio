import type { LocalIntegrationUser } from './local-supabase-fixtures.ts';
import { decimalAdd, decimalString } from '../../lib/domain/money.ts';

type CleanupOptions = { supabaseUrl: string; serviceRoleKey: string; userId: string };
export type LocalImportAccountType = 'individual' | 'traditional_ira' | 'roth_ira';
export type LocalImportAcceptanceOptions = {
  accountName?: string;
  accountType?: LocalImportAccountType;
  verifyPersistedProjections?: boolean;
  /** Independent expected cash total from the fixture's economic activity. */
  expectedLedgerCash?: string;
};

type ImportResponse = { import?: { id?: unknown; status?: unknown; review?: { acceptedRowCount?: unknown }; activityFrom?: unknown; activityThrough?: unknown } };

/** Exercises the real API, Supabase Auth session and import RPCs together. */
export async function runLocalImportAcceptance(
  apiBaseUrl: string,
  user: Pick<LocalIntegrationUser, 'accessToken'>,
  csv: string,
  fetcher: typeof fetch = fetch,
  cleanup?: CleanupOptions,
  options: LocalImportAcceptanceOptions = {},
): Promise<void> {
  const headers = { authorization: `Bearer ${user.accessToken}`, 'content-type': 'application/json' };
  const create = await fetcher(`${apiBaseUrl}/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ name: options.accountName ?? 'Local import smoke', accountType: options.accountType ?? 'individual' }) });
  if (create.status !== 201) throw new Error(`Local import account creation failed with HTTP ${create.status}.`);
  const accountBody = await parseJson(create, 'account creation');
  const accountId = stringAt(accountBody, 'account', 'id');
  if (!accountId) throw new Error('Local import account creation returned no account ID.');

  const importResponse = await fetcher(`${apiBaseUrl}/v1/accounts/${accountId}/imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${user.accessToken}`, 'content-type': 'text/csv', 'x-file-name': 'local-import-smoke.csv' },
    body: csv,
  });
  if (importResponse.status !== 201) throw new Error(`Local Robinhood import staging failed with HTTP ${importResponse.status}.`);
  const staged = await parseJson(importResponse, 'import staging');
  const importId = stringAt(staged, 'import', 'id');
  if (!importId || stringAt(staged, 'import', 'status') !== 'ready_for_review') throw new Error('Local Robinhood import did not reach review-ready state.');
  if ((numberAt(staged, 'import', 'review', 'acceptedRowCount') ?? 0) < 1) throw new Error('Local Robinhood import accepted no rows.');

  const detail = await fetcher(`${apiBaseUrl}/v1/imports/${importId}`, { headers: { authorization: `Bearer ${user.accessToken}` } });
  if (detail.status !== 200) throw new Error(`Local import review lookup failed with HTTP ${detail.status}.`);
  const detailBody = await parseJson(detail, 'import review');
  if (!Array.isArray(detailBody.sourceRows) || detailBody.sourceRows.length < 1) throw new Error('Local import review returned no immutable source rows.');

  const commit = await fetcher(`${apiBaseUrl}/v1/imports/${importId}/commit`, { method: 'POST', headers: { authorization: `Bearer ${user.accessToken}` } });
  if (commit.status !== 200 || stringAt(await parseJson(commit, 'import commit'), 'import', 'status') !== 'committed') throw new Error(`Local import commit did not complete (HTTP ${commit.status}).`);
  if (options.verifyPersistedProjections) {
    if (!cleanup) throw new Error('Persisted projection verification requires service-role cleanup credentials.');
    await verifyCommittedProjections(cleanup, accountId, importId, fetcher, options.expectedLedgerCash);
  }
  const undo = await fetcher(`${apiBaseUrl}/v1/imports/${importId}/undo`, { method: 'POST', headers: { authorization: `Bearer ${user.accessToken}` } });
  if (undo.status !== 200 || stringAt(await parseJson(undo, 'import undo'), 'import', 'status') !== 'undone') throw new Error(`Local import undo did not complete (HTTP ${undo.status}).`);
  if (options.verifyPersistedProjections) {
    await verifyUndoneProjections(cleanup!, accountId, importId, fetcher);
  }
  if (cleanup) {
    const deleted = await fetcher(`${cleanup.supabaseUrl}/rest/v1/rpc/delete_user_account_data`, {
      method: 'POST',
      headers: { apikey: cleanup.serviceRoleKey, authorization: `Bearer ${cleanup.serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user_id: cleanup.userId, p_account_id: accountId }),
    });
    if (!deleted.ok) {
      const detail = (await deleted.text().catch(() => '')).trim().slice(0, 240);
      throw new Error(`Local import cleanup failed with HTTP ${deleted.status}${detail ? `: ${detail}` : '.'}`);
    }
  }
}

async function verifyCommittedProjections(cleanup: CleanupOptions, accountId: string, importId: string, fetcher: typeof fetch, expectedCash?: string): Promise<void> {
  const ledger = await readServiceRows(cleanup, 'ledger_entries', `account_id=eq.${accountId}&import_id=eq.${importId}&select=id,entry_type,cash_amount,quantity`, fetcher);
  if (ledger.length < 1) throw new Error('Committed import produced no persisted ledger entries.');
  if (expectedCash !== undefined) {
    const cash = ledger.reduce((total, row) => {
      const raw = row.cash_amount;
      // PostgREST may decode PostgreSQL NUMERIC as a JSON number in local
      // fixtures; normalize immediately into Decimal so no arithmetic uses a
      // JavaScript float.
      if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('Persisted ledger row is missing its exact cash amount.');
      return decimalAdd(total, decimalString(raw));
    }, decimalString('0'));
    if (cash !== decimalString(expectedCash)) throw new Error(`Persisted ledger cash mismatch: expected ${expectedCash}, got ${cash}.`);
  }
  const lots = await readServiceRows(cleanup, 'lots', `account_id=eq.${accountId}&select=id,remaining_quantity,total_cost_basis`, fetcher);
  if (lots.length < 1) throw new Error('Committed import produced no persisted FIFO lots.');
}

async function verifyUndoneProjections(cleanup: CleanupOptions, accountId: string, importId: string, fetcher: typeof fetch): Promise<void> {
  const ledger = await readServiceRows(cleanup, 'ledger_entries', `account_id=eq.${accountId}&import_id=eq.${importId}&select=id`, fetcher);
  if (ledger.length < 1) throw new Error('Undo removed immutable ledger evidence.');
  const lots = await readServiceRows(cleanup, 'lots', `account_id=eq.${accountId}&select=id`, fetcher);
  if (lots.length !== 0) throw new Error('Undo left derived FIFO lots behind.');
}

async function readServiceRows(cleanup: CleanupOptions, table: string, query: string, fetcher: typeof fetch): Promise<Array<Record<string, unknown>>> {
  const response = await fetcher(`${cleanup.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { apikey: cleanup.serviceRoleKey, authorization: `Bearer ${cleanup.serviceRoleKey}` } });
  if (!response.ok) throw new Error(`Local persisted ${table} verification failed with HTTP ${response.status}.`);
  const value: unknown = await response.json().catch(() => undefined);
  if (!Array.isArray(value)) throw new Error(`Local persisted ${table} verification returned invalid JSON.`);
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

async function parseJson(response: Response, label: string): Promise<Record<string, any>> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Local ${label} returned invalid JSON.`);
  return value as Record<string, any>;
}

function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current = value;
  for (const key of path) { if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined; current = (current as Record<string, unknown>)[key]; }
  return typeof current === 'string' ? current : undefined;
}

function numberAt(value: unknown, ...path: string[]): number | undefined {
  let current = value;
  for (const key of path) { if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined; current = (current as Record<string, unknown>)[key]; }
  return typeof current === 'number' ? current : undefined;
}
