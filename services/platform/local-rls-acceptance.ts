import type { LocalIntegrationUser, LocalSupabaseCredentials } from './local-supabase-fixtures.ts';

type User = Pick<LocalIntegrationUser, 'label' | 'userId' | 'accessToken'>;
type Fetcher = typeof fetch;

function baseUrl(credentials: Pick<LocalSupabaseCredentials, 'apiUrl'>): string {
  return credentials.apiUrl.replace(/\/$/, '');
}

function userHeaders(user: User, anonKey: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: anonKey,
    authorization: `Bearer ${user.accessToken}`,
    ...extra,
  };
}

function serviceHeaders(serviceRoleKey: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function expectStatus(response: Response, expected: number[], action: string): Promise<void> {
  if (!expected.includes(response.status)) {
    const detail = (await response.text()).trim().slice(0, 240);
    throw new Error(`${action} returned HTTP ${response.status}; expected ${expected.join(' or ')}${detail ? `: ${detail}` : '.'}`);
  }
}

async function readJson(response: Response, action: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${action} did not return JSON.`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Runs real PostgREST and Storage requests with two local Auth sessions.
 * This intentionally tests the database policy boundary rather than a repository mock.
 */
export async function runLocalRlsAcceptance(
  credentials: LocalSupabaseCredentials,
  users: [User, User],
  fetcher: Fetcher = fetch,
): Promise<void> {
  const [userA, userB] = users;
  const base = baseUrl(credentials);
  const accountName = `RLS acceptance ${Date.now()}`;
  const create = await fetcher(`${base}/rest/v1/accounts`, {
    method: 'POST',
    headers: userHeaders(userA, credentials.anonKey, {
      'content-type': 'application/json',
      prefer: 'return=representation',
    }),
    body: JSON.stringify({ user_id: userA.userId, account_type: 'individual', name: accountName }),
  });
  await expectStatus(create, [201], 'owner account creation');
  const created = await readJson(create, 'owner account creation');
  const account = Array.isArray(created) ? created[0] as { id?: unknown; user_id?: unknown; name?: unknown } : undefined;
  assert(typeof account?.id === 'string', 'Owner account creation did not return an account ID.');
  assert(account.user_id === userA.userId, 'Owner account creation returned the wrong user owner.');

  const accountFilter = encodeURIComponent(`eq.${account.id}`);
  const ownerRead = await fetcher(`${base}/rest/v1/accounts?id=${accountFilter}&select=id,user_id,name`, {
    headers: userHeaders(userA, credentials.anonKey),
  });
  await expectStatus(ownerRead, [200], 'owner account read');
  const ownerRows = await readJson(ownerRead, 'owner account read');
  assert(Array.isArray(ownerRows) && ownerRows.length === 1, 'Owner could not read the created account.');

  const guessedRead = await fetcher(`${base}/rest/v1/accounts?id=${accountFilter}&select=id,user_id,name`, {
    headers: userHeaders(userB, credentials.anonKey),
  });
  await expectStatus(guessedRead, [200], 'cross-user guessed account read');
  const guessedRows = await readJson(guessedRead, 'cross-user guessed account read');
  assert(Array.isArray(guessedRows) && guessedRows.length === 0, 'Cross-user guessed account ID was visible.');

  const attemptedUpdate = await fetcher(`${base}/rest/v1/accounts?id=${accountFilter}`, {
    method: 'PATCH',
    headers: userHeaders(userB, credentials.anonKey, { 'content-type': 'application/json', prefer: 'return=representation' }),
    body: JSON.stringify({ name: 'Cross-user mutation' }),
  });
  await expectStatus(attemptedUpdate, [200], 'cross-user account update');
  const updateRows = await readJson(attemptedUpdate, 'cross-user account update');
  assert(Array.isArray(updateRows) && updateRows.length === 0, 'Cross-user account update returned a row.');

  const attemptedDelete = await fetcher(`${base}/rest/v1/accounts?id=${accountFilter}`, {
    method: 'DELETE',
    headers: userHeaders(userB, credentials.anonKey),
  });
  await expectStatus(attemptedDelete, [204], 'cross-user account delete');

  const serviceRead = await fetcher(`${base}/rest/v1/accounts?id=${accountFilter}&select=id,user_id,name`, {
    headers: serviceHeaders(credentials.serviceRoleKey),
  });
  await expectStatus(serviceRead, [200], 'service account verification');
  const serviceRows = await readJson(serviceRead, 'service account verification');
  assert(Array.isArray(serviceRows) && serviceRows.length === 1, 'Cross-user mutation deleted or duplicated the owner account.');
  assert((serviceRows[0] as { name?: unknown }).name === accountName, 'Cross-user mutation changed the owner account.');

  const invalidRead = await fetcher(`${base}/rest/v1/accounts?select=id`, {
    headers: { apikey: credentials.anonKey, authorization: 'Bearer invalid-local-session' },
  });
  await expectStatus(invalidRead, [401], 'invalid session account read');

  const globalWrite = await fetcher(`${base}/rest/v1/instruments`, {
    method: 'POST',
    headers: userHeaders(userA, credentials.anonKey, { 'content-type': 'application/json' }),
    body: JSON.stringify({ id: '33333333-3333-4333-8333-333333333333', asset_type: 'stock', display_name: 'Browser write probe' }),
  });
  await expectStatus(globalWrite, [401, 403], 'browser global reference write');

  const objectPath = `${userA.userId}/rls-acceptance-${Date.now()}.csv`;
  let uploaded = false;
  try {
    const upload = await fetcher(`${base}/storage/v1/object/brokerage-statements/${objectPath}`, {
      method: 'POST',
      headers: userHeaders(userA, credentials.anonKey, { 'content-type': 'text/csv', 'x-upsert': 'true' }),
      body: 'Date,Amount\n2026-01-01,1.00\n',
    });
    await expectStatus(upload, [200], 'owner private object upload');
    uploaded = true;
    const ownerObject = await fetcher(`${base}/storage/v1/object/brokerage-statements/${objectPath}`, {
      headers: userHeaders(userA, credentials.anonKey),
    });
    await expectStatus(ownerObject, [200], 'owner private object read');
    const otherObject = await fetcher(`${base}/storage/v1/object/brokerage-statements/${objectPath}`, {
      headers: userHeaders(userB, credentials.anonKey),
    });
    await expectStatus(otherObject, [400, 404], 'cross-user private object read');
  } finally {
    if (uploaded) {
      const serviceDelete = await fetcher(`${base}/storage/v1/object/brokerage-statements/${objectPath}`, {
        method: 'DELETE',
        headers: serviceHeaders(credentials.serviceRoleKey),
      });
      await expectStatus(serviceDelete, [200], 'service private object cleanup');
    }
  }

  console.log('Live RLS acceptance passed: owner access, guessed-ID isolation, cross-user mutation denial, invalid-session denial, private Storage policy, and service-only global writes.');
}
