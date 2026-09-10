import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthService, type SupabaseAuthPort } from '@/services/auth/supabase-auth';

function authPort(): SupabaseAuthPort {
  return {
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe('Supabase authentication service', () => {
  it('validates credentials before calling Supabase', async () => {
    const port = authPort();
    await expect(createSupabaseAuthService(port).signIn({ email: 'not-email', password: 'short' })).rejects.toThrow();
    expect(port.signInWithPassword).not.toHaveBeenCalled();
  });

  it('delegates verified email/password and Google flows without retaining passwords', async () => {
    const port = authPort();
    const service = createSupabaseAuthService(port);
    await service.signUp({ email: 'user@example.com', password: 'a-long-password' }, 'https://app.example.com/auth/callback');
    await service.startGoogleSignIn('https://app.example.com/auth/callback');
    expect(port.signUp).toHaveBeenCalledWith({ email: 'user@example.com', password: 'a-long-password', options: { emailRedirectTo: 'https://app.example.com/auth/callback' } });
    expect(port.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://app.example.com/auth/callback' } });
  });

  it('surfaces provider failures', async () => {
    const port = authPort();
    vi.mocked(port.signOut).mockResolvedValue({ error: { message: 'Session expired.' } });
    await expect(createSupabaseAuthService(port).signOut()).rejects.toThrow('Session expired.');
    expect(port.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('validates and submits a password from a recovery session', async () => {
    const port = authPort();
    await createSupabaseAuthService(port).updatePassword('a-new-long-password');
    expect(port.updateUser).toHaveBeenCalledWith({ password: 'a-new-long-password' });
    await expect(createSupabaseAuthService(port).updatePassword('short')).rejects.toThrow();
  });

  it('uses the dedicated recovery route for reset links', async () => {
    const port = authPort();
    await createSupabaseAuthService(port).sendPasswordReset(' user@example.com ', 'https://app.example.com/auth/recovery');
    expect(port.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', { redirectTo: 'https://app.example.com/auth/recovery' });
  });
});
