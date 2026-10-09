import { expect, test } from '@playwright/test';
import { OWNER, SHOP } from './helpers';

test('«Войти»: a rounded glass button top-right that stays on screen while scrolling', async ({ page }) => {
  await page.goto(`${SHOP}/`);
  const btn = page.getByTestId('account-button');
  await expect(btn).toHaveText(/Войти/);
  const vw = page.viewportSize()!.width;
  const box = (await btn.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(vw - 40); // top-right corner
  expect(box.y).toBeLessThan(40);
  expect(await btn.evaluate((e) => getComputedStyle(e).position === 'fixed' || getComputedStyle(e.parentElement!).position === 'fixed')).toBe(true);
  expect(await btn.evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThanOrEqual(box.height / 2 - 1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(200);
  await expect(btn).toBeInViewport();
  const hit = await btn.evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  expect(hit).toBe(true);
  // the pinned catalog bar leaves room for it
  await page.goto(`${SHOP}/catalog`);
  await page.getByTestId('section-bouquets').waitFor();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(page.locator('.cat-tabs--sticky')).toHaveClass(/is-pinned/);
  const rowRight = await page.locator('.cat-tabs__row').evaluate((e) => e.getBoundingClientRect().right);
  expect(rowRight).toBeLessThanOrEqual((await btn.boundingBox())!.x + 1);
});

test('the owner signs in with the account button and lands in the cabinet', async ({ page }) => {
  await page.goto(`${SHOP}/`);
  await page.getByTestId('account-button').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Личный кабинет' })).toBeVisible();
  await expect(page.getByText(/Скоро здесь можно будет войти по номеру телефона/)).toBeVisible();
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByTestId('login').click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: /кабинет/ })).toBeVisible();
  await expect(page.getByTestId('account-button')).toHaveText(/Кабинет/);
});

test('add-product dialog: solid panel, every field and the buttons fit on a small phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${SHOP}/admin`);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByTestId('login').click();
  await page.getByText('Товары и наличие').first().click();
  await expect(page.getByTestId('owner-section-fireworks')).toBeVisible();
  await page.getByTestId('owner-filter-fireworks').click();
  await expect(page.getByTestId('owner-section-bouquets')).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить товар' }).click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toBeVisible();
  expect(await dlg.evaluate((d) => getComputedStyle(d).backgroundColor)).toMatch(/^rgb\(/); // opaque, not rgba(…, 0.x)
  const vp = page.viewportSize()!;
  const box = (await dlg.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  await expect(dlg.getByRole('combobox', { name: 'Раздел каталога' })).toContainText('Фейерверки'); // preselected from the filter
  await expect(dlg.getByRole('button', { name: 'Сохранить' })).toBeInViewport();
  const file = dlg.locator('.astryx-file-input, input[type=file]').first();
  await file.scrollIntoViewIfNeeded();
  const fb = (await dlg.getByText('Выберите файл').boundingBox())!;
  expect(fb.y + fb.height).toBeLessThanOrEqual(box.y + box.height);
  expect(fb.x + fb.width).toBeLessThanOrEqual(box.x + box.width);
  await ctx.close();
});
