import { expect, test } from '@playwright/test';

test('landing page explains the prototype and links to the demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /know how your portfolio is really doing/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /explore the synthetic demo/i })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByText(/accounts, storage, billing, and live market data are not connected yet/i)).toBeVisible();
});

test('sign-in page keeps unavailable credentials explicit', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: /your whole portfolio, in focus/i })).toBeVisible();
  await expect(page.getByText(/live account experience is being built/i)).toBeVisible();
});

test('dashboard demo is clearly labeled as synthetic', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Synthetic demo · no account connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: /portfolio example/i })).toBeVisible();
  await expect(page.getByText(/fictional long-term portfolio/i)).toBeVisible();
});
