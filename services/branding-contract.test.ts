import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relativePath: string) =>
  readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8',
  );

describe('Northstar brand contract', () => {
  it('uses the same compass mark in the component and favicon', () => {
    const mark = read('components/brand-mark.tsx');
    const favicon = read('public/favicon.svg');
    expect(mark).toContain('M20 7.5 23.4 16.6 32.5 20');
    expect(favicon).toContain('M20 7.5 23.4 16.6 32.5 20');
    expect(favicon).toContain('<title>Northstar</title>');
  });

  it('keeps the document title, application name, and icon aligned', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain("title: 'Northstar — Portfolio clarity'");
    expect(layout).toContain("applicationName: 'Northstar'");
    expect(layout).toContain("icon: '/favicon.svg'");
  });

  it('does not make an adjacent wordmark announce the icon twice', () => {
    const mark = read('components/brand-mark.tsx');
    expect(mark).toContain('aria-hidden={label ? undefined : true}');
    expect(mark).toContain("role={label ? 'img' : undefined}");
  });
});
