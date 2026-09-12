/** Convert provider errors into short, actionable messages for end users. */
export function userFacingAuthError(error: unknown, fallback = 'We could not complete that request.'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.trim().toLowerCase();
  if (!message) return fallback;
  if (message.includes('google') && (message.includes('not enabled') || message.includes('unsupported provider'))) {
    return 'Google sign-in is not enabled yet. Ask the site owner to enable Google in Supabase, or use email and password.';
  }
  if (message.includes('redirect') && (message.includes('url') || message.includes('not allowed'))) {
    return 'Google sign-in is not configured for this website yet. Ask the site owner to add this website URL in Supabase.';
  }
  if (message.includes('network') || message.includes('failed to fetch')) {
    return 'We could not reach the sign-in service. Check your internet connection and try again.';
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}
