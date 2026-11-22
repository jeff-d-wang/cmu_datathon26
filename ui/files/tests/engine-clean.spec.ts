import { test, expect } from '@playwright/test';

// engine_clean mode (live read-only query). Start the server with VITE_DATA_SOURCE=engine_clean, then run with ENGINE_CLEAN=1.
test.skip(process.env.ENGINE_CLEAN !== '1', 'set ENGINE_CLEAN=1 with the server in engine_clean mode');

test('engine clean: Jaipur 302001, chest pressure shows heading, needs, real pins and a Call link', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.getByLabel('State').selectOption('RAJASTHAN');
  await page.getByLabel('District, town or PIN').fill('302001');
  await page.getByRole('option', { name: /302001/ }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /I have symptoms/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Chest pressure' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Health care near Jaipur');
  await expect(page.getByText('Clean data (local preview)')).toHaveCount(0);
  await expect(page.getByTestId('engine-needs')).toContainText('Emergency care');
  await expect(page.getByRole('button', { name: 'What similar visits involved' })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.getByRole('article').count()).toBeGreaterThan(3);
  await expect(page.locator('.hc-pin-dot').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Call / }).first()).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/screenshots/engine-clean.png' });
});

test('engine clean: Delhi shows all places, outside rows, details, no forbidden words', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByLabel('State').selectOption('DELHI');
  await page.getByLabel('District, town or PIN').fill('110001');
  await page.getByRole('option', { name: /110001/ }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /I have symptoms/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Chest pressure' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Health care near New Delhi');
  await expect(page.getByText(/For .+ · \d+ places?/)).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/screenshots/ec-results.png' });
  const more = page.getByRole('button', { name: /^Show more/ });
  if (await more.count()) await more.click();
  expect(await page.getByRole('article').count()).toBeGreaterThan(15);
  const bad = /\bnull\b|\bundefined\b|\bNaN\b/;
  expect(await page.locator('body').innerText()).not.toMatch(bad);
  await page.getByRole('article').first().getByRole('button', { name: /^Why this score/ }).click();
  await expect(page.getByText('How the number is made').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/screenshots/ec-why.png' });
  await page.getByRole('article').first().getByRole('button', { name: /^Why this score/ }).click();

  await page.getByRole('slider').fill('5');
  await expect(page.getByRole('heading', { name: 'Outside your radius' })).toBeVisible();
  const rows = page.locator('li button[aria-label^="Full details"]');
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.first().locator('span[aria-hidden]').first().innerText()).toBe('A');
  await expect(page.locator('.hc-pin-muted', { hasText: /^A$/ })).toHaveCount(1);
  expect(await rows.filter({ hasText: 'Dental' }).count()).toBe(0);
  const toggle = page.getByRole('button', { name: /^Show \d+ places with little or no evidence/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await rows.count()).toBeGreaterThan(0);
  await rows.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/screenshots/ec-outside.png' });

  await page.getByRole('article').first().getByRole('button', { name: /^Full details/ }).click();
  await expect(page.getByText('What the record lists')).toBeVisible();
  await expect(page.getByText('(straight line)')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  expect(text.match(/(High|Medium|Low) confidence/g)?.length).toBe(1);
  expect(text).not.toMatch(/Alvin/);
  expect(text).not.toMatch(/\bUS\b/);
  expect(text).not.toMatch(bad);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/screenshots/ec-detail.png' });
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(page.getByRole('heading', { name: 'Outside your radius' })).toBeVisible();
});

test('engine clean: "new delhi" typed in Delhi shows suggestions', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('State').selectOption('DELHI');
  await page.getByLabel('District, town or PIN').fill('new delhi');
  await expect(page.locator('#place-list [role=option]').first()).toBeVisible();
  await expect(page.getByText('No match')).toHaveCount(0);
});

test('engine clean: mobile 390x844 hides the map on step 1 and shows a strip on results', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('State').selectOption('DELHI');
  await page.getByLabel('District, town or PIN').fill('110001');
  await page.getByRole('option', { name: /110001/ }).first().click();
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /I have symptoms/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Chest pressure' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/screenshots/ec-mobile.png' });
  await ctx.close();
});
