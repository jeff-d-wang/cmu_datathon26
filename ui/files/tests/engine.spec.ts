import { test, expect } from '@playwright/test';

// Engine fixture mode. Start the server with VITE_DATA_SOURCE=engine_fixture, then run with ENGINE=1.
test.skip(process.env.ENGINE !== '1', 'set ENGINE=1 with the server in engine_fixture mode');

test('engine fixture: Jaipur, chest pressure shows advisory, needs panel and top result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: /302001/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Find health care near me/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Chest pressure' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Engine demo results (fixture)')).toBeVisible();
  await expect(page.getByText('If this is sudden or severe, call 112 (or 108 for an ambulance) before travelling.').first()).toBeVisible();
  await expect(page.getByText('What similar emergency visits involved')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Shekhawati Hospital & Research Centre' })).toBeVisible();
  await expect(page.getByText('Score, not a probability').first()).toBeVisible();

  await page.getByRole('button', { name: 'Why this score' }).first().click();
  await expect(page.getByText(/match 0\.83 × relevance 1\.00/)).toBeVisible();

  // % is allowed only inside the needs panel.
  const needs = page.getByTestId('engine-needs');
  await expect(needs).toContainText('%');
  const outside = await page.locator('main').evaluate((m) => {
    const c = m.cloneNode(true) as HTMLElement;
    c.querySelector('[data-testid="engine-needs"]')?.remove();
    return c.innerText;
  });
  expect(outside).not.toContain('%');

  // Radius only filters: shrinking it moves Shekhawati (5.6 km) to the outside list, order kept.
  await page.getByLabel('Search radius').fill('5');
  await expect(page.getByText('Outside your radius')).toBeVisible();
});
