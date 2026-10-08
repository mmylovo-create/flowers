import { expect, test } from '@playwright/test';
import { SHOP } from './helpers';

test('home page: photo, name, bouquets with prices, reviews, contacts and order buttons', async ({ page }) => {
  await page.goto(`${SHOP}/`);
  await expect(page.getByRole('img', { name: /Букет от Флёр/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Флёр' })).toBeVisible();
  await expect(page.getByText('Собираем букеты из сезонных цветов')).toBeVisible();
  const cta = page.getByTestId('hero-cta');
  await expect(cta).toHaveText(/Записаться/);
  // the wide glass button sits on the hero photo
  const hero = await page.locator('#hero-media').boundingBox();
  const btn = await cta.boundingBox();
  expect(btn!.y).toBeGreaterThan(hero!.y);
  expect(btn!.y + btn!.height).toBeLessThanOrEqual(hero!.y + hero!.height);
  expect(btn!.width).toBeGreaterThan(Math.min(300, hero!.width * 0.4));
  await expect(page.getByTestId('bouquet-pion-cloud')).toContainText(/5\s900 ₽/);
  await expect(page.getByRole('heading', { name: 'Отзывы с Яндекс Карт' })).toBeVisible();
  await expect(page.getByText('Заказала пионы маме на юбилей', { exact: false })).toBeVisible();
  const contactHeading = page.getByRole('heading', { name: 'Связаться с нами' }).first();
  await contactHeading.scrollIntoViewIfNeeded();
  await expect(contactHeading).toBeVisible();
  await expect(page.getByText(/Москва, ул\. Покровка, \d+/).first()).toBeVisible(); // the owner test may have edited the number
  await expect(page.getByText(/Пн–Пт: 09:00–21:00/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Заказать букет' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Позвонить/ }).first()).toHaveAttribute('href', 'tel:+79991234567');
});

test('glass navigation: Главная, Букеты, Мои заказы, and it never hides the end of the page', async ({ page }) => {
  await page.goto(`${SHOP}/`);
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  for (const name of ['Главная', 'Букеты', 'Скидки', 'Мои заказы']) await expect(nav.getByRole('link', { name })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  const navBox = (await nav.boundingBox())!;
  const lastBottom = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    const kids = main.querySelectorAll('.reveal, section, [class*="card"], button, a');
    let max = 0;
    kids.forEach((k) => { const r = k.getBoundingClientRect(); if (r.height > 0) max = Math.max(max, r.bottom); });
    return max;
  });
  expect(lastBottom).toBeLessThanOrEqual(navBox.y);
  await nav.getByRole('link', { name: 'Букеты' }).click();
  await expect(page).toHaveURL(/\/s\/demo\/bouquets$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Букеты' })).toBeVisible();
});

test('sections appear on scroll, and instantly with reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${SHOP}/`);
  const opacities = await page.locator('.reveal').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  expect(opacities.every((o) => o === '1')).toBe(true);
  await ctx.close();

  const ctx2 = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 390, height: 700 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${SHOP}/`);
  const last = p2.locator('.reveal').last();
  await expect(last).not.toHaveClass(/is-visible/);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveClass(/is-visible/);
  await ctx2.close();
});

test('«Скидки» tab: order in advance, quantity discounts, contact us', async ({ page }) => {
  await page.goto(`${SHOP}/advance`);
  await expect(page.getByRole('heading', { name: 'Цветы можно заказать заранее' })).toBeVisible();
  await expect(page.getByText('От 3 букетов')).toBeVisible();
  await expect(page.getByText('−10%')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Связаться с нами' })).toBeVisible();
});
