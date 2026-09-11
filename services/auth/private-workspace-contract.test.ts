import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('private workspace routing contract', () => {
  it('keeps the dashboard dynamic and session-gated before private app rendering', async () => {
    const source = await readFile(new URL('../../app/dashboard/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain("export const dynamic = 'force-dynamic';");
    expect(source.indexOf('await requirePrivateSession')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('await requirePrivateSession')).toBeLessThan(source.indexOf('return <PortfolioApp'));
    expect(source).toContain('readPublicSupabaseConfig(process.env)');
  });

  it('keeps the public demo free of authentication and API configuration', async () => {
    const source = await readFile(new URL('../../app/demo/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('supabaseConfig={undefined}');
    expect(source).toContain('apiConfig={undefined}');
    expect(source).not.toContain('requirePrivateSession');
  });
});
