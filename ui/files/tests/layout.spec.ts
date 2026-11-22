import { test, expect, type Page } from '@playwright/test';

// Regression: on desktop only the task panel scrolls (never two scrollbars), and every screen uses the
// same panel width and title size (consistent proportions).
const check = async (page: Page) => {
  const r = await page.evaluate(() => ({
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    panelOverflowsSideways: (() => { const m = document.getElementById('hc-main')!; return m.scrollWidth > m.clientWidth + 1; })(),
    panelWidth: Math.round(document.getElementById('hc-main')?.getBoundingClientRect().width ?? 0),
    h1: getComputedStyle(document.querySelector('h1')!).fontSize,
  }));
  expect(r).toEqual({ pageScrolls: false, panelOverflowsSideways: false, panelWidth: 520, h1: '24px' });
};

for (const h of [800, 700]) {
  test(`one scrollbar and consistent panel at 1280x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: h });
    await page.goto('/');
    await check(page);
    await page.getByLabel('State').selectOption('TELANGANA');
    await page.getByLabel('District, town or PIN').fill('karim');
    await page.getByRole('option', { name: /Karimnagar district/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await check(page);
    await page.getByRole('radio', { name: /I have symptoms/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await check(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await check(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await check(page);
    await page.getByRole('button', { name: /Full details/ }).first().click();
    await check(page);
  });
}
