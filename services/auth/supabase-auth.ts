import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(128),
});

type AuthResponse = { error: { message: string } | null };

export type SupabaseAuthPort = {
  signUp(input: { email: string; password: string; options: { emailRedirectTo: string } }): Promise<AuthResponse>;
  signInWithPassword(input: { email: string; password: string }): Promise<AuthResponse>;
  signInWithOAuth(input: { provider: 'google'; options: { redirectTo: string } }): Promise<AuthResponse>;
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<AuthResponse>;
  signOut(): Promise<AuthResponse>;
};

function assertSuccess(response: AuthResponse) {
  if (response.error) throw new Error(response.error.message);
}

export function createSupabaseAuthService(auth: SupabaseAuthPort) {
  return {
    async signUp(input: z.input<typeof credentialsSchema>, emailRedirectTo: string) {
      const credentials = credentialsSchema.parse(input);
      assertSuccess(await auth.signUp({ ...credentials, options: { emailRedirectTo } }));
    },
    async signIn(input: z.input<typeof credentialsSchema>) {
      const credentials = credentialsSchema.parse(input);
      assertSuccess(await auth.signInWithPassword(credentials));
    },
    async startGoogleSignIn(redirectTo: string) {
      assertSuccess(await auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }));
    },
    async sendPasswordReset(email: string, redirectTo: string) {
      const validatedEmail = z.string().trim().email().parse(email);
      assertSuccess(await auth.resetPasswordForEmail(validatedEmail, { redirectTo }));
    },
    async signOut() {
      assertSuccess(await auth.signOut());
    },
  };
}
