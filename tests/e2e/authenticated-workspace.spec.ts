import { expect, test } from '@playwright/test';

const email = process.env.E2E_AUTH_EMAIL;
const password = process.env.E2E_AUTH_PASSWORD;
const secondEmail = process.env.E2E_AUTH_EMAIL_B;
const secondPassword = process.env.E2E_AUTH_PASSWORD_B;

async function signIn(page: import('@playwright/test').Page, userEmail: string, userPassword: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(userEmail);
  await page.getByLabel('Password').fill(userPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if ((await page.url()).includes('/sign-in')) {
    const status = await page.getByRole('status').textContent().catch(() => null);
    if (status) throw new Error(`Sign-in client error: ${status}`);
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
}

test('authenticated user reaches the private workspace', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD for the integration environment.');
  await signIn(page, email!, password!);
  await expect(page.getByText('Signed in · account workspace')).toBeVisible();
});

test('authenticated workspace can switch account scope and sign out cleanly', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD for the integration environment.');
  await signIn(page, email!, password!);

  const accountSelector = page.getByLabel('Select account for report');
  if (await accountSelector.isVisible().catch(() => false)) {
    const values = await accountSelector.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    if (values.length > 1) {
      await accountSelector.selectOption(values[1]);
      await expect(accountSelector).toHaveValue(values[1]);
    }
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: /Welcome back|Sign-in is being configured/ })).toBeVisible();
});

test('local fixture users can create supported accounts and cannot see each other', async ({ browser }) => {
  test.skip(!email || !password || !secondEmail || !secondPassword, 'The local browser harness supplies two disposable Auth fixtures.');
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await signIn(firstPage, email!, password!);
  await firstPage.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(firstPage.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  for (const account of [
    { name: 'Local taxable', type: 'individual' },
    { name: 'Local traditional IRA', type: 'traditional_ira' },
    { name: 'Local Roth IRA', type: 'roth_ira' },
  ]) {
    await firstPage.getByRole('button', { name: 'Add account', exact: true }).first().click();
    await firstPage.getByLabel('Account name').fill(account.name);
    await firstPage.getByLabel('Account type').selectOption(account.type);
    await firstPage.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(firstPage.getByText(account.name, { exact: true })).toBeVisible();
  }
  const accountSelector = firstPage.getByLabel('Select account for report');
  await firstPage.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(accountSelector).toHaveCount(1);
  await expect(accountSelector.locator('option')).toHaveCount(3);
  const rothId = await accountSelector.locator('option').filter({ hasText: 'Local Roth IRA' }).getAttribute('value');
  expect(rothId).toBeTruthy();
  await accountSelector.selectOption(rothId!);
  await expect(accountSelector).toHaveValue(rothId!);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await signIn(secondPage, secondEmail!, secondPassword!);
  await expect(secondPage.getByText('Local taxable', { exact: true })).toHaveCount(0);
  await secondPage.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(secondPage.getByText('Add your Robinhood account')).toBeVisible();
  await expect(secondPage.getByText('Local traditional IRA', { exact: true })).toHaveCount(0);

  await firstPage.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(firstPage).toHaveURL(/\/sign-in$/);
  await secondContext.close();
  await firstContext.close();
});
