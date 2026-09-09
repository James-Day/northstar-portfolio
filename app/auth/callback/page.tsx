import { AuthCallbackPage } from '@/components/auth-callback-page';

export default function AuthCallback() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return <AuthCallbackPage supabaseConfig={url && anonKey ? { url, anonKey } : undefined} />;
}
