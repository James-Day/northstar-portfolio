import { PortfolioApp } from '@/components/portfolio-app';
import { readPublicApiConfig, readPublicSupabaseConfig } from '@/lib/platform/config';
import { requirePrivateSession } from '@/services/auth/private-route';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requirePrivateSession({
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return <PortfolioApp supabaseConfig={readPublicSupabaseConfig(process.env)} apiConfig={readPublicApiConfig(process.env)} />;
}
