import { test, expect, devices } from '@playwright/test';

// Full flow in real browsers against the local short-race server (see e2e/serve.mjs).
test.skip(({ baseURL }) => !baseURL.includes('localhost'), 'joins and starts races: local only');

async function joinPhone(browser, name) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('#name').fill(name);
  await page.locator('#start').click();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#myname')).toHaveText(name);
  return { ctx, page };
}

test('Start is disabled until a phone joins', async ({ page, browser }) => {
  await page.goto('/screen');
  await expect(page.locator('#startRace')).toBeDisabled();
  const p = await joinPhone(browser, 'Turbo Potato');
  await expect(page.locator('#count')).toHaveText('1 player');
  await expect(page.locator('#startRace')).toBeEnabled();
  await p.ctx.close();
  await expect(page.locator('#count')).toHaveText('0 players');
});

test('no tilt on desktop: phone falls back to steering buttons', async ({ browser }) => {
  const p = await joinPhone(browser, 'Button Masher');
  await expect(p.page.locator('#buttons')).toBeVisible({ timeout: 5_000 });
  await expect(p.page.locator('#left')).toBeVisible();
  await expect(p.page.locator('#right')).toBeVisible();
  await p.ctx.close();
});

test('two phones race: Start → countdown → GO → results → Race again', async ({ page, browser }) => {
  await page.goto('/screen');
  const a = await joinPhone(browser, 'Sir Crashalot');
  const b = await joinPhone(browser, 'Merge Conflict');
  await expect(page.locator('#count')).toHaveText('2 players');

  await page.locator('#startRace').click();
  await expect(page.locator('#startRace')).toBeHidden();
  await expect(page.locator('#overlay')).toContainText(/[123]/);
  await expect(page.locator('#timer')).toBeVisible({ timeout: 3_000 });

  // Steer a bit on one phone while racing.
  await a.page.locator('#left').dispatchEvent('pointerdown');
  await a.page.waitForTimeout(300);
  await a.page.locator('#left').dispatchEvent('pointerup');

  await expect(page.locator('#overlay')).toContainText('Results', { timeout: 10_000 });
  await expect(page.locator('#overlay')).toContainText('Sir Crashalot');
  await expect(page.locator('#overlay')).toContainText('Merge Conflict');
  await expect(page.locator('#startRace')).toHaveText('Race again');

  await a.ctx.close();
  await b.ctx.close();
});
