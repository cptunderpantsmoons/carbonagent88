import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await _electron.launch({
    args: ['dist/main.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      E2E: 'true',
    },
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('playground view initial render matches baseline', async () => {
  // Wait for the Playground view heading to appear
  await expect(page.locator('h1#page-title')).toHaveText('Playground', { timeout: 10000 });

  // Screenshot the full window
  await expect(page).toHaveScreenshot('playground-initial.png');
});

test('sidebar matches baseline', async () => {
  const sidebar = page.locator('aside, nav, [role="navigation"]').first();
  await expect(sidebar).toBeVisible({ timeout: 5000 });

  await expect(sidebar).toHaveScreenshot('sidebar.png');
});
