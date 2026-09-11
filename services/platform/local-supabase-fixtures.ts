export type LocalSupabaseCredentials = {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

export type LocalIntegrationUser = {
  label: 'a' | 'b';
  email: string;
  password: string;
  userId: string;
  accessToken: string;
};

export class LocalIntegrationUsersError extends Error {
  readonly createdUsers: LocalIntegrationUser[];
  constructor(message: string, createdUsers: LocalIntegrationUser[]) {
    super(message);
    this.name = 'LocalIntegrationUsersError';
    this.createdUsers = createdUsers;
  }
}

export const LOCAL_INTEGRATION_USERS = [
  {
    label: 'a' as const,
    email: 'portfolio-integration-a@example.test',
    password: 'local-integration-a-2026-only',
  },
  {
    label: 'b' as const,
    email: 'portfolio-integration-b@example.test',
    password: 'local-integration-b-2026-only',
  },
] as const;

type Fetcher = typeof fetch;

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses `supabase status -o env` without printing any credential values. */
export function parseSupabaseStatusEnv(output: string): LocalSupabaseCredentials {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);
    if (match) values.set(match[1], parseEnvValue(match[2]));
  }

  const apiUrl = values.get('API_URL') ?? values.get('SUPABASE_URL');
  const anonKey = values.get('ANON_KEY') ?? values.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY') ?? values.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('`supabase status -o env` did not provide API_URL, ANON_KEY, and SERVICE_ROLE_KEY.');
  }
  return { apiUrl: apiUrl.replace(/\/$/, ''), anonKey, serviceRoleKey };
}

function authHeaders(anonKey: string): HeadersInit {
  return { apikey: anonKey, 'content-type': 'application/json' };
}

/** Creates the two known local users through Auth; credentials remain in memory only. */
export async function createLocalIntegrationUsers(
  credentials: Pick<LocalSupabaseCredentials, 'apiUrl' | 'anonKey'>,
  fetcher: Fetcher = fetch,
): Promise<LocalIntegrationUser[]> {
  const created: LocalIntegrationUser[] = [];
  for (const fixture of LOCAL_INTEGRATION_USERS) {
    const response = await fetcher(`${credentials.apiUrl.replace(/\/$/, '')}/auth/v1/signup`, {
      method: 'POST',
      headers: authHeaders(credentials.anonKey),
      body: JSON.stringify({ email: fixture.email, password: fixture.password }),
    });
    if (!response.ok) throw new LocalIntegrationUsersError(`Local Auth fixture ${fixture.label} creation failed with HTTP ${response.status}.`, created);
    const body = (await response.json()) as { user?: { id?: unknown } | null; access_token?: unknown };
    if (typeof body.user?.id !== 'string' || typeof body.access_token !== 'string') {
      throw new LocalIntegrationUsersError(`Local Auth fixture ${fixture.label} did not return a user session.`, created);
    }
    created.push({ ...fixture, userId: body.user.id, accessToken: body.access_token });
  }
  return created;
}

/** Removes only users created by this run, using the local service-role key. */
export async function deleteLocalIntegrationUsers(
  credentials: Pick<LocalSupabaseCredentials, 'apiUrl' | 'serviceRoleKey'>,
  users: Pick<LocalIntegrationUser, 'userId'>[],
  fetcher: Fetcher = fetch,
): Promise<void> {
  for (const user of [...users].reverse()) {
    const response = await fetcher(`${credentials.apiUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(user.userId)}`, {
      method: 'DELETE',
      headers: { apikey: credentials.serviceRoleKey, authorization: `Bearer ${credentials.serviceRoleKey}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Local Auth fixture cleanup failed with HTTP ${response.status}.`);
  }
}
