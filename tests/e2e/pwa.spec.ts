import { expect, test } from '@playwright/test';
import { SHOP } from './helpers';

test('installable: own manifest, icon and offline service worker per shop', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'Chromium install checks run once');
  await page.goto(`${SHOP}/`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/t/demo/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/t/demo/apple-touch-icon.png');
  const manifest = await (await page.request.get('/t/demo/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Флёр', start_url: '/s/demo/', scope: '/s/demo/', display: 'standalone' });
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);

  // service worker takes control
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || false, null, { timeout: 20_000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });
  });

  // Chrome's own installability verdict
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  // works without network after the first visit
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Флёр' })).toBeVisible();
  await page.goto(`${SHOP}/bouquets`);
  await expect(page.getByTestId('bouquet-pion-cloud')).toBeVisible();
  await context.setOffline(false);
});

test('each shop has its own address /s/<name>/ with its own page head', async ({ request }) => {
  const html = await (await request.get(`${SHOP}/`)).text();
  expect(html).toContain('<title>Флёр — Цветочная студия с доставкой по городу</title>');
  expect(html).toContain('/t/demo/manifest.webmanifest');
});
