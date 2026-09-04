const { test, expect } = require('@playwright/test');

const endpoint = process.env.APPS_SCRIPT_URL || '';
const token = process.env.JUNK_DRAWER_TOKEN || '';
const hasBackendSecrets = Boolean(endpoint && token);

async function connectIfPossible(page) {
  if (!hasBackendSecrets) return false;

  await page.evaluate(({ endpoint, token }) => {
    localStorage.setItem('billsJunkDrawerConnectionV1', JSON.stringify({ endpoint, token }));
  }, { endpoint, token });

  await page.reload({ waitUntil: 'networkidle' });
  return true;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => {
    console.error('PAGEERROR:', error.message);
  });
  page.on('requestfailed', request => {
    console.warn('REQUESTFAILED:', request.method(), request.url(), request.failure()?.errorText || '');
  });

  await page.goto('/', { waitUntil: 'networkidle' });
});

test('deployed app loads and primary sections default closed', async ({ page }) => {
  await expect(page).toHaveTitle(/junk drawer/i);

  await expect(page.locator('#composeToggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#composeBody')).toHaveClass(/hidden/);

  await expect(page.locator('#drawerToggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#drawerBody')).toHaveClass(/hidden/);
});

for (const [label, tabId, paneId] of [
  ['Note', '#noteTab', '#textPane'],
  ['Link', '#linkTab', '#textPane'],
  ['File', '#fileTab', '#filePane']
]) {
  test(`${label} tab opens the entry section`, async ({ page }) => {
    await page.locator(tabId).click();
    await expect(page.locator('#composeToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#composeBody')).not.toHaveClass(/hidden/);
    await expect(page.locator(paneId)).not.toHaveClass(/hidden/);

    await page.locator('#composeToggle').click();
    await expect(page.locator('#composeToggle')).toHaveAttribute('aria-expanded', 'false');
  });
}

test('mobile image viewer stays inside viewport when opened', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-sized-chromium', 'Mobile-only layout check');
  test.skip(!hasBackendSecrets, 'APPS_SCRIPT_URL and JUNK_DRAWER_TOKEN are not configured');

  await connectIfPossible(page);

  await page.locator('#drawerToggle').click();
  await expect(page.locator('#drawerBody')).not.toHaveClass(/hidden/);

  const imageOpen = page.locator('[data-action="preview"]').first();
  test.skip(await imageOpen.count() === 0, 'No image item is currently available to preview');

  await imageOpen.click();
  await expect(page.locator('#imageViewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#viewerImage')).not.toHaveClass(/hidden/);

  const box = await page.locator('#viewerImage').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
});

test('file items expose a download action', async ({ page }) => {
  test.skip(!hasBackendSecrets, 'APPS_SCRIPT_URL and JUNK_DRAWER_TOKEN are not configured');

  await connectIfPossible(page);
  await page.locator('#drawerToggle').click();

  const fileItems = page.locator('.item').filter({ has: page.locator('.icon', { hasText: '📎' }) });
  test.skip(await fileItems.count() === 0, 'No file item is currently available');

  const firstFile = fileItems.first();
  const downloadControl = firstFile.locator('a[download], a:has-text("Download"), button:has-text("Download")');
  await expect(downloadControl, 'Uploaded files should expose a visible Download action').toHaveCount(1);
});
