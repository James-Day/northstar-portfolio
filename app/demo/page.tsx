import { PortfolioApp } from '@/components/portfolio-app';

/** Public synthetic portfolio; it deliberately receives no Supabase config. */
export default function DemoPage() {
  return <PortfolioApp apiConfig={undefined} supabaseConfig={undefined} />;
}
