import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySupabaseSession, type AuthenticatedUser, type SupabaseSessionConfig } from '@/services/auth/server-session';

export const PRIVATE_SESSION_COOKIE = 'northstar_private_session';
export type PrivateRouteConfig = SupabaseSessionConfig & { signInPath?: string };

/** Verify the HttpOnly session handoff before a private page renders. */
export async function requirePrivateSession(config: PrivateRouteConfig): Promise<AuthenticatedUser> {
  const token = (await cookies()).get(PRIVATE_SESSION_COOKIE)?.value;
  const signInPath = config.signInPath ?? '/sign-in?next=/dashboard';
  if (!token) redirect(signInPath);
  const user = await verifySupabaseSession(new Request('https://northstar.internal/session', { headers: { authorization: `Bearer ${token}` } }), config);
  if (!user) redirect(signInPath);
  return user;
}
