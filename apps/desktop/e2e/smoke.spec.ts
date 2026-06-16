import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

test('launches the Carbon Agent window', async () => {
  const title = await page.title();
  expect(title).toContain('Carbon');

  const heading = page.locator('.logo-text');
  await expect(heading).toContainText(/Carbon/i, { timeout: 5000 });
});

test('has no critical or serious accessibility violations', async () => {
  // Legacy mode avoids creating a new page, which Electron contexts do not support.
  const accessibilityScanResults = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  const violations = accessibilityScanResults.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  expect(violations).toEqual([]);
});
