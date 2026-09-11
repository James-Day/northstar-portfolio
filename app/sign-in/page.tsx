import { SignInPage } from '@/components/sign-in-page';
import { readPublicSupabaseConfig } from '@/lib/platform/config';
import { readAuthRedirectOrigins } from '@/lib/auth/redirects';

export default function SignIn() {
  return <SignInPage supabaseConfig={readPublicSupabaseConfig(process.env)} authRedirectOrigins={readAuthRedirectOrigins(process.env)} />;
}
