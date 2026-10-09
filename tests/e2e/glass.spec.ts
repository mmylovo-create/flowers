import { expect, test } from '@playwright/test';
import { SHOP } from './helpers';

// With a GPU the real liquid-gl lens is on; it disables taps on its element unless we restore them.
// `?glass=force` turns the lens on even where the browser renders WebGL in software.
test('real glass: bottom buttons and «Заказать букет» stay tappable', async ({ page }) => {
  await page.goto(`${SHOP}/?glass=force`);
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const ready = await page.locator('.bottom-nav.glass--gl').waitFor({ timeout: 20_000 }).then(() => true, () => false);
  test.skip(!ready, 'WebGL is not available in this browser');
  test.slow(); // software WebGL in CI renders the lenses at a few frames per second

  for (let i = 0; i < 2; i++) {
    await nav.getByRole('link', { name: 'Каталог' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible({ timeout: 30_000 });
    await nav.getByRole('link', { name: 'Главная' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Флёр' })).toBeVisible({ timeout: 30_000 });
  }
  await nav.getByRole('link', { name: 'Скидки' }).click();
  await expect(page).toHaveURL(/\/advance/);
  await nav.getByRole('link', { name: 'Мои заказы' }).click();
  await expect(page).toHaveURL(/\/orders$/);

  await page.goto(`${SHOP}/?glass=force`);
  await page.locator('.hero__cta.glass--gl').waitFor({ timeout: 20_000 });
  await page.getByTestId('hero-cta').click();
  await expect(page).toHaveURL(/\/catalog/);
});

// The label is plain text above the lens canvas. Anything that turns the button into its own
// stacking context (e.g. a transform used for centring on desktop) would hide it under the glass.
test('real glass: the «Заказать букет» label stays above the lens', async ({ page }) => {
  await page.goto(`${SHOP}/?glass=force`);
  const ready = await page.locator('.hero__cta.glass--gl').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  test.skip(!ready, 'WebGL is not available in this browser');
  await expect(page.getByTestId('hero-cta')).toHaveText(/Заказать букет/);
  const onTop = await page.evaluate(() => {
    const cta = document.querySelector<HTMLElement>('.hero__cta')!;
    const label = cta.querySelector<HTMLElement>('.hero__cta-label')!;
    label.style.pointerEvents = 'auto'; // only for the hit test
    const r = label.getBoundingClientRect();
    const hits = [0.2, 0.5, 0.8].map((fx) => document.elementFromPoint(r.x + r.width * fx, r.y + r.height / 2));
    label.style.pointerEvents = '';
    return { ok: hits.every((h) => !!h && label.contains(h)), transform: getComputedStyle(cta).transform };
  });
  expect(onTop.transform).toBe('none');
  expect(onTop.ok).toBe(true);
});
