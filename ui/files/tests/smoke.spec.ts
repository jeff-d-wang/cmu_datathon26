import { test, expect, type Page } from '@playwright/test';

// Runs the whole flow on SAMPLE data (default). Saves one screenshot per screen to tests/screenshots/.
const place = async (page: Page, text = 'karimnagar') => {
  await page.getByLabel('State').selectOption('TELANGANA');
  await page.getByLabel('District, town or PIN').fill(text);
  await page.getByRole('option', { name: /Karimnagar district/ }).click();
};
const toIntent = async (page: Page) => {
  await page.goto('/');
  await place(page);
  await page.getByRole('button', { name: 'Continue' }).click();
};
const shot = (page: Page, name: string) => page.screenshot({ path: `tests/screenshots/${name}.png`, fullPage: false });

test('intent: nothing preselected, Continue disabled, emergency banner present', async ({ page }) => {
  await toIntent(page);
  await expect(page.getByRole('heading', { name: 'What do you need today?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose one to continue' })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Emergency numbers' })).toContainText('Do not drive yourself');
  await shot(page, '1-intent');
});

test('"Help right now" opens the emergency screen in one click', async ({ page }) => {
  await toIntent(page);
  await page.getByRole('radio', { name: /Emergency: get help now/ }).click();
  await expect(page.getByRole('heading', { name: 'Call now. Do not wait for results.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Call 112/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Call 108/ })).toBeVisible();
  await expect(page.getByText('Places near you that list emergency care')).toHaveCount(0);
  await shot(page, '1b-emergency');
});

test('full planned flow to results and detail', async ({ page }) => {
  await toIntent(page);
  await page.getByRole('radio', { name: /Find heart care near me/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Who is this for?' })).toBeVisible();
  await page.getByRole('radio', { name: 'I am the patient' }).click();
  await page.getByLabel('Patient’s age in years').fill('52');
  await page.getByRole('radio', { name: 'Woman' }).click();
  await shot(page, '2-who');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Describe your symptoms')).toBeVisible();
  // Symptom typeahead: an everyday phrase suggests the matching symptom.
  await page.getByRole('combobox', { name: 'Describe your symptoms' }).fill('tight ch');
  await page.getByRole('option', { name: /Chest pressure/ }).click();
  await expect(page.getByRole('button', { name: 'Remove Chest pressure' })).toBeVisible();
  await page.getByRole('button', { name: 'Unusual tiredness' }).click();
  // Symptoms outside the quick picks are found by typing; anything else can be added in your own words.
  const box = page.getByRole('combobox', { name: 'Describe your symptoms' });
  await box.fill('cough');
  await page.getByRole('option', { name: 'Cough', exact: true }).click();
  await box.fill('itchy skin');
  await page.getByRole('option', { name: /Add “itchy skin” in your own words/ }).click();
  await expect(page.getByRole('button', { name: 'Remove itchy skin' })).toBeVisible();
  await shot(page, '3-symptoms');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: /matches in our data/ })).toBeVisible();
  await expect(page.getByText('Not an endorsement', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: /Match score \d+/ }).first()).toBeVisible();
  await expect(page.getByText('What we assumed')).toBeVisible();
  await page.getByRole('button', { name: 'Why this score' }).first().click();
  await expect(page.getByText('Treatment match').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('%');
  await page.getByRole('radio', { name: 'mi', exact: true }).click();
  await expect(page.getByRole('article').first()).toContainText(/\d+ mi|under 1 mi/);
  await page.getByLabel('Search radius').fill('5');
  await expect(page.getByText('Outside your radius')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Match score' }).first()).toBeVisible();
  await page.getByLabel('Search radius').fill('25');
  await page.waitForTimeout(2500); // let street-map tiles load
  await shot(page, '4-results');
  await page.getByRole('button', { name: 'Hide map' }).click();
  await shot(page, '4b-results-no-map');
  await page.getByRole('button', { name: 'Show map' }).click();

  await page.getByRole('button', { name: /Full details/ }).first().click();
  await expect(page.getByText('What the data lists, and what it does not')).toBeVisible();
  await expect(page.getByText('Cost is not in our data', { exact: false })).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, '5-detail');

  await page.getByRole('button', { name: 'Start over (new person)' }).click();
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible();
});

test('a safety-check tick goes straight to emergency', async ({ page }) => {
  await toIntent(page);
  await page.getByRole('radio', { name: /Find heart care near me/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Breathless while resting').click();
  await expect(page.getByRole('heading', { name: 'Call now. Do not wait for results.' })).toBeVisible();
});

test('picking stroke signs opens the emergency screen', async ({ page }) => {
  await toIntent(page);
  await page.getByRole('radio', { name: /Find heart care near me/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Describe your symptoms' }).fill('slurred');
  await page.getByRole('option', { name: /slurred speech/ }).click();
  await expect(page.getByRole('heading', { name: 'Call now. Do not wait for results.' })).toBeVisible();
});

test('a worrying word warns but does not hijack the flow', async ({ page }) => {
  await toIntent(page);
  await page.getByRole('radio', { name: /Find heart care near me/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Describe your symptoms' }).fill('sweating a lot');
  await page.getByRole('option', { name: /in your own words/ }).click();
  await expect(page.getByText('Some of what you entered can be a sign of an emergency.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'It is happening now: get help' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /matches in our data/ })).toBeVisible();
});
