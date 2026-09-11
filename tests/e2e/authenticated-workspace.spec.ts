import { expect, test } from '@playwright/test';

const email = process.env.E2E_AUTH_EMAIL;
const password = process.env.E2E_AUTH_PASSWORD;

test('authenticated user reaches the private workspace', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD for the integration environment.');
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await expect(page.getByText('Signed in · account workspace')).toBeVisible();
});
