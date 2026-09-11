import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const workspace = new URL('../components/portfolio-app.tsx', import.meta.url);
const settings = new URL('../components/settings-panel.tsx', import.meta.url);

describe('workspace accessibility contract', () => {
  it('keeps keyboard landmarks, labeled controls, table scopes, and responsive table regions present', async () => {
    const [app, panel] = await Promise.all([readFile(workspace, 'utf8'), readFile(settings, 'utf8')]);
    expect(app).toContain('href="#main-content"');
    expect(app).toContain('aria-label="Portfolio navigation"');
    expect(app).toContain('aria-label="Select account for report"');
    expect(app).toMatch(/overflow-x-auto[\s\S]*<table/);
    expect(app).toMatch(/<th\s+scope="col"/);
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('role="status"');
    expect(panel).toContain('Request account deletion');
  });

  it('does not introduce unlabeled icon-only navigation buttons', async () => {
    const app = await readFile(workspace, 'utf8');
    const iconOnly = [...app.matchAll(/<button[^>]*>\s*<\w+\s+size=[^>]+\/>\s*<\/button>/g)];
    expect(iconOnly).toEqual([]);
  });
});
