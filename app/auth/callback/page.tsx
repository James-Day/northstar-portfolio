import { AuthCallbackPage } from '@/components/auth-callback-page';
import { readPublicSupabaseConfig } from '@/lib/platform/config';

export default function AuthCallback() {
  return <AuthCallbackPage supabaseConfig={readPublicSupabaseConfig(process.env)} />;
}
