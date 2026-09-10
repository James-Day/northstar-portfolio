import { SignInPage } from '@/components/sign-in-page';
import { readPublicSupabaseConfig } from '@/lib/platform/config';

export default function SignIn() {
  return <SignInPage supabaseConfig={readPublicSupabaseConfig(process.env)} />;
}
