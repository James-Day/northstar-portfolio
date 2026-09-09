export type SupabaseSessionConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export type SessionFetch = typeof fetch;

export class SessionConfigurationError extends Error {
  constructor() {
    super('Supabase session verification is not configured.');
  }
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length).trim();
  return token || undefined;
}

export async function verifySupabaseSession(
  request: Request,
  config: SupabaseSessionConfig,
  requestFetch: SessionFetch = fetch,
): Promise<AuthenticatedUser | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new SessionConfigurationError();

  const response = await requestFetch(new URL('/auth/v1/user', config.supabaseUrl), {
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return undefined;
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') return undefined;

  const { id, email } = payload as { id?: unknown; email?: unknown };
  if (typeof id !== 'string' || !id) return undefined;
  return { id, ...(typeof email === 'string' ? { email } : {}) };
}
