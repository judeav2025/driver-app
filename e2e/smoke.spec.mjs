import { test, expect } from '@playwright/test';

// Read-only checks, safe against the live site during a demo: no join, no Start.

test('@smoke health is ok', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(['lobby', 'countdown', 'racing', 'results']).toContain(body.phase);
});

test('@smoke big screen connects and shows a QR code', async ({ page }) => {
  await page.goto('/screen');
  await expect(page.locator('#qr')).toBeVisible();
  await expect(page.locator('#qr')).toHaveJSProperty('complete', true);
  expect(await page.locator('#qr').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#status')).toHaveText('', { timeout: 10_000 }); // '' once connected
  await expect(page.locator('#count')).toHaveText(/\d+ players?/);
});

test('@smoke phone page shows the join form', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#name')).toBeVisible();
  await expect(page.locator('#start')).toHaveText('Start your engine');
});
