/**
 * Exchange the browser Supabase access token for the server-owned session
 * cookie. Keeping this request in one small helper makes password, OAuth, and
 * recovery flows use the same fail-closed behavior.
 */
export async function establishBrowserSession(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!accessToken.trim()) return false;
  const response = await fetcher('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  return response.ok;
}
