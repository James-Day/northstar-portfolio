import { describe, expect, it } from 'vitest';
import { userFacingAuthError } from '@/lib/auth/user-facing-error';

describe('userFacingAuthError', () => {
  it('explains that an unconfigured Google provider needs an administrator', () => {
    expect(userFacingAuthError(new Error('Unsupported provider: google'))).toContain('Google sign-in is not enabled yet');
  });

  it('explains redirect configuration failures without exposing provider internals', () => {
    expect(userFacingAuthError(new Error('redirect URL is not allowed'))).toContain('add this website URL');
  });

  it('gives a useful network retry message', () => {
    expect(userFacingAuthError(new Error('Failed to fetch'))).toContain('internet connection');
  });

  it('bounds unexpected provider details', () => {
    const message = userFacingAuthError(new Error('x'.repeat(500)));
    expect(message.length).toBeLessThanOrEqual(241);
  });
});
