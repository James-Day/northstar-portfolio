const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled. You can try again whenever you are ready.',
  server_error: 'Google sign-in could not be completed. Please try again.',
  temporarily_unavailable: 'Google sign-in is temporarily unavailable. Please try again shortly.',
};

/**
 * Converts an OAuth callback error into a safe, user-facing message. Provider
 * descriptions are treated as untrusted input and are bounded before display.
 */
export function readOAuthCallbackError(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const code = params.get('error')?.trim().toLowerCase();
  if (!code) return null;

  const known = CALLBACK_ERROR_MESSAGES[code];
  if (known) return known;

  const description = params.get('error_description')?.trim().replace(/\s+/g, ' ');
  if (description) return `Sign-in could not be completed: ${description.slice(0, 240)}`;
  return 'Sign-in could not be completed. Please return to sign in and try again.';
}
