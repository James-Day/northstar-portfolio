import { expect, test } from '@playwright/test';

test('landing page explains the prototype and links to the demo', async ({ page }) => {
  await page.goto('/');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveAttribute('href', '#main-content');
  await expect(page.getByRole('heading', { name: /know how your portfolio is really doing/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /explore the synthetic demo/i })).toHaveAttribute('href', '/demo');
  await expect(page.getByText(/accounts, storage, billing, and live market data are not connected yet/i)).toBeVisible();
});

test('sign-in page keeps unavailable credentials explicit', async ({ page }) => {
  await page.goto('/sign-in');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveAttribute('href', '#auth-content');
  await expect(page.getByRole('heading', { name: /your whole portfolio, in focus/i })).toBeVisible();
  await expect(page.getByText(/live account experience is being built/i)).toBeVisible();
});

test('dashboard demo is clearly labeled as synthetic', async ({ page }) => {
  const chartWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('width(-1) and height(-1)')) chartWarnings.push(message.text());
  });
  await page.goto('/demo');
  await expect(page.getByText('Synthetic demo · no account connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: /portfolio example/i })).toBeVisible();
  await expect(page.getByText(/fictional long-term portfolio/i)).toBeVisible();
  expect(chartWarnings, 'the responsive portfolio chart should not render with negative dimensions').toEqual([]);
});

test('configured dashboard does not render private data while signed out', async ({ page }) => {
  await page.goto('/dashboard');
  const privateBoundary = page.getByRole('heading', { name: /sign in to your workspace/i });
  const authBoundary = page.getByRole('heading', { name: /your whole portfolio, in focus/i });
  const demo = page.getByText('Synthetic demo · no account connected');
  await expect(privateBoundary.or(authBoundary).or(demo)).toBeVisible();
  if (await privateBoundary.isVisible()) {
    await expect(page.getByText(/connected accounts and portfolio reports are private/i)).toBeVisible();
  }
  if (await authBoundary.isVisible()) {
    await expect(page.getByText(/live account experience is being built/i)).toBeVisible();
  }
});

test('public surfaces remain keyboard reachable and fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/sign-in', '/demo']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} should not overflow horizontally at 375px`).toBe(false);
    const firstLink = page.getByRole('link').first();
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
  }
});
