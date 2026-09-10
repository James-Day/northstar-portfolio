import { PortfolioApp } from '@/components/portfolio-app';
import { readPublicSupabaseConfig } from '@/lib/platform/config';

export default function DashboardPage() {
  return <PortfolioApp supabaseConfig={readPublicSupabaseConfig(process.env)} />;
}
