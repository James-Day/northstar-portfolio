import { PasswordRecoveryPage } from '@/components/password-recovery-page';
import { readPublicSupabaseConfig } from '@/lib/platform/config';

export default function RecoveryPage() {
  return <PasswordRecoveryPage supabaseConfig={readPublicSupabaseConfig(process.env)} />;
}
