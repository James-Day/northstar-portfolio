import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const portfolioApp = readFileSync(
  fileURLToPath(new URL('../components/portfolio-app.tsx', import.meta.url)),
  'utf8',
);

describe('authenticated workspace accessibility contract', () => {
  it('gives every rendered data table a caption and column header scope', () => {
    const tables = [...portfolioApp.matchAll(/<table[\s\S]*?<\/table>/g)].map(
      (match) => match[0],
    );

    expect(tables.length).toBeGreaterThanOrEqual(7);
    for (const table of tables) {
      expect(table).toMatch(/<caption[\s\S]*?<\/caption>/);
      expect(table).not.toMatch(/<th\b(?![^>]*scope=)/);
    }
  });

  it('provides a keyboard escape path and an announced mobile navigation relationship', () => {
    expect(portfolioApp).toMatch(/event\.key === ['"]Escape['"]/);
    expect(portfolioApp).toMatch(/id=['"]portfolio-navigation['"]/);
    expect(portfolioApp).toMatch(/aria-controls=['"]portfolio-navigation['"]/);
    expect(portfolioApp).toMatch(/aria-expanded=\{menuOpen\}/);
    expect(portfolioApp).toMatch(/aria-label=['"]Close navigation['"]/);
  });
});
