import { SignInPage } from '@/components/sign-in-page';

export default function SignIn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return <SignInPage supabaseConfig={url && anonKey ? { url, anonKey } : undefined} />;
}
