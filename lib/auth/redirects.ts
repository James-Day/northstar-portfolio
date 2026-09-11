const AUTH_PATHS = {
  callback: '/auth/callback',
  recovery: '/auth/recovery',
} as const;

export type AuthRedirectPath = keyof typeof AUTH_PATHS;

/**
 * Return an exact origin for an auth redirect. Redirect destinations are
 * constructed from a fixed path and an allow-listed origin; caller supplied
 * URLs are never passed through to Supabase.
 */
export function buildAuthRedirectUrl(
  origin: string,
  path: AuthRedirectPath,
  allowedOrigins: readonly string[],
): string {
  const parsed = parseOrigin(origin);
  const allowed = allowedOrigins.map(parseOrigin);
  if (!allowed.some((candidate) => candidate.href === parsed.href)) {
    throw new Error('This app origin is not configured for authentication redirects.');
  }
  return new URL(AUTH_PATHS[path], parsed).toString();
}

/** Parse only clean HTTP(S) origins and normalize their trailing slash. */
export function parseOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Authentication redirect origin must be an absolute HTTP(S) origin.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Authentication redirect origin must be an absolute HTTP(S) origin.');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Authentication redirect origin must be a clean HTTP(S) origin.');
  }
  return parsed;
}

export function readAuthRedirectOrigins(env: Record<string, string | undefined>): string[] {
  const configured = (env.NEXT_PUBLIC_AUTH_ORIGINS ?? env.NEXT_PUBLIC_APP_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = configured.length > 0
    ? configured
    : (env.NODE_ENV ?? 'development') === 'production'
      ? []
      : ['http://localhost:3000', 'http://127.0.0.1:3000'];
  // Validate at startup/build time rather than constructing a redirect that
  // Supabase will reject later or, worse, accepting a hostile origin.
  return origins.map((origin) => parseOrigin(origin).origin);
}
