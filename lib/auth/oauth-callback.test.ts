import { describe, expect, it } from 'vitest';
import { readOAuthCallbackError } from '@/lib/auth/oauth-callback';

describe('readOAuthCallbackError', () => {
  it('gives cancelled consent a clear retry message', () => {
    expect(readOAuthCallbackError('?error=access_denied')).toContain('cancelled');
  });

  it('bounds and normalizes an untrusted provider description', () => {
    const description = '  provider   supplied   details '.repeat(30);
    const message = readOAuthCallbackError(`?error=oauth_error&error_description=${encodeURIComponent(description)}`);
    expect(message).toMatch(/^Sign-in could not be completed: provider supplied details/);
    expect(message?.length).toBeLessThanOrEqual(275);
  });

  it('returns no error for a normal callback', () => {
    expect(readOAuthCallbackError('?code=oauth-code')).toBeNull();
  });

  it('reads fragment errors without exposing fragment tokens', () => {
    const message = readOAuthCallbackError('', '#error=access_denied&access_token=secret-token');
    expect(message).toContain('cancelled');
    expect(message).not.toContain('secret-token');
  });

  it('prefers a query error over an unrelated fragment value', () => {
    expect(readOAuthCallbackError('?error=server_error', '#error=access_denied')).toContain('could not be completed');
  });
});
