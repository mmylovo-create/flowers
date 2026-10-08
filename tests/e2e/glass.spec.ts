import { expect, test } from '@playwright/test';
import { SHOP } from './helpers';

// With a GPU the real liquid-gl lens is on; it disables taps on its element unless we restore them.
// `?glass=force` turns the lens on even where the browser renders WebGL in software.
test('real glass: bottom buttons and «Записаться» stay tappable', async ({ page }) => {
  await page.goto(`${SHOP}/?glass=force`);
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const ready = await page.locator('.bottom-nav.glass--gl').waitFor({ timeout: 20_000 }).then(() => true, () => false);
  test.skip(!ready, 'WebGL is not available in this browser');

  for (let i = 0; i < 2; i++) {
    await nav.getByRole('link', { name: 'Каталог' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible();
    await nav.getByRole('link', { name: 'Главная' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Флёр' })).toBeVisible();
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
