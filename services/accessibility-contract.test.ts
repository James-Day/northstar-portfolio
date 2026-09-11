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

  it('gives the authenticated workspace a skip target and button semantics', () => {
    expect(portfolioApp).toMatch(/href="#main-content"[\s\S]*?Skip to content/);
    expect(portfolioApp).toMatch(/id="main-content"[\s\S]*?tabIndex=\{?-1\}?/);
    expect(portfolioApp).toMatch(/<button\s+type="button"\s+onClick=\{signOut\}/);
    expect(portfolioApp).toMatch(/<button\s+key=\{label\}\s+type="button"/);
  });

  it('keeps dialogs usable at small widths and gives each one a labelled description', () => {
    const dialogContents = [...portfolioApp.matchAll(/<DialogContent\s+className="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(dialogContents.length).toBeGreaterThanOrEqual(2);
    for (const className of dialogContents) {
      expect(className).toMatch(/max-h-\[90vh\]/);
      expect(className).toMatch(/overflow-auto/);
    }
    expect((portfolioApp.match(/<DialogTitle/g) ?? []).length).toBeGreaterThanOrEqual(
      dialogContents.length,
    );
    expect((portfolioApp.match(/<DialogDescription/g) ?? []).length).toBeGreaterThanOrEqual(
      dialogContents.length,
    );
  });

  it('places every data table inside a horizontally scrollable region for zoomed layouts', () => {
    const tableStarts = [...portfolioApp.matchAll(/<table\b/g)].map((match) => match.index ?? 0);

    expect(tableStarts.length).toBeGreaterThanOrEqual(7);
    for (const start of tableStarts) {
      const context = portfolioApp.slice(Math.max(0, start - 320), start);
      expect(context).toMatch(/className="[^"]*overflow-(?:x-)?auto[^"]*"/);
    }
  });
});
