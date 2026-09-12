import type { LocalIntegrationUser } from './local-supabase-fixtures.ts';

type CleanupOptions = { supabaseUrl: string; serviceRoleKey: string; userId: string };

type ImportResponse = { import?: { id?: unknown; status?: unknown; review?: { acceptedRowCount?: unknown }; activityFrom?: unknown; activityThrough?: unknown } };

/** Exercises the real API, Supabase Auth session and import RPCs together. */
export async function runLocalImportAcceptance(
  apiBaseUrl: string,
  user: Pick<LocalIntegrationUser, 'accessToken'>,
  csv: string,
  fetcher: typeof fetch = fetch,
  cleanup?: CleanupOptions,
): Promise<void> {
  const headers = { authorization: `Bearer ${user.accessToken}`, 'content-type': 'application/json' };
  const create = await fetcher(`${apiBaseUrl}/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ name: 'Local import smoke', accountType: 'individual' }) });
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
  const undo = await fetcher(`${apiBaseUrl}/v1/imports/${importId}/undo`, { method: 'POST', headers: { authorization: `Bearer ${user.accessToken}` } });
  if (undo.status !== 200 || stringAt(await parseJson(undo, 'import undo'), 'import', 'status') !== 'undone') throw new Error(`Local import undo did not complete (HTTP ${undo.status}).`);
  if (cleanup) {
    const deleted = await fetcher(`${cleanup.supabaseUrl}/rest/v1/rpc/delete_user_account_data`, {
      method: 'POST',
      headers: { apikey: cleanup.serviceRoleKey, authorization: `Bearer ${cleanup.serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user_id: cleanup.userId, p_account_id: accountId }),
    });
    if (!deleted.ok) throw new Error(`Local import cleanup failed with HTTP ${deleted.status}.`);
  }
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
