import { PortfolioApp } from '@/components/portfolio-app';
import { readPublicApiConfig, readPublicSupabaseConfig } from '@/lib/platform/config';

export default function DashboardPage() {
  return <PortfolioApp supabaseConfig={readPublicSupabaseConfig(process.env)} apiConfig={readPublicApiConfig(process.env)} />;
}
