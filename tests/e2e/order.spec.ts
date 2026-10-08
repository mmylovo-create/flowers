import { expect, test } from '@playwright/test';
import { fillCustomer, firstFreeSlot, openOrderForm, SHOP, tomorrow } from './helpers';

test('bouquet page offers a postcard; basket → order with both, then «Мои заказы» and cancel', async ({ page }) => {
  await page.goto(`${SHOP}/catalog/bouquets`);
  await page.getByTestId('bouquet-morning-garden').getByRole('link', { name: 'Утренний сад' }).click();
  await expect(page).toHaveURL(/\/s\/demo\/b\/morning-garden$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Утренний сад' })).toBeVisible();
  await expect(page.getByTestId('product-price')).toHaveText(/4\s200 ₽/);
  await expect(page.getByText('Кустовые розы, ранункулюсы и маттиола')).toBeVisible();
  // the postcard is offered right away, nothing pre-selected
  const offer = page.getByTestId('card-offer');
  await expect(offer.getByRole('heading', { name: 'Добавить открытку?' })).toBeVisible();
  await expect(offer.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Больше' }).click();
  await page.getByRole('button', { name: 'Больше' }).click();
  await expect(page.getByTestId('qty')).toHaveText('3');
  await expect(page.getByText('Скидка 5% за количество')).toBeVisible();
  await page.getByTestId('card-option-card-love').click();
  await page.getByLabel('Текст открытки').fill('С годовщиной! Люблю');
  await expect(page.getByTestId('add-to-cart')).toContainText(/12\s850 ₽/);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByText('Добавлено в корзину')).toBeVisible();
  await expect(page.getByTestId('cart-button')).toContainText('4');

  await page.getByTestId('cart-button').click();
  await expect(page.getByRole('heading', { name: 'Корзина и оформление' })).toBeVisible();
  await expect(page.getByTestId('qty-morning-garden')).toHaveText('3');
  await expect(page.getByTestId('cart-line-card-love').getByLabel('Текст открытки')).toHaveValue('С годовщиной! Люблю');
  await page.getByTestId(`day-${tomorrow()}`).click();
  const { slot, time } = await firstFreeSlot(page);
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await fillCustomer(page);
  // 3 × 4200 = 12 600 − 5% (630) + postcard 250 = 12 220, delivery free
  await expect(page.getByTestId('total')).toHaveText(/12\s220 ₽/);
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Заказ №\d+/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`${time}–`)).first()).toBeVisible();
  await expect(page.getByText('Москва, ул. Пушкина, 10, кв. 5')).toBeVisible();
  await expect(page.getByTestId('order-item')).toHaveCount(2);
  await expect(page.getByText('Текст открытки: «С годовщиной! Люблю»')).toBeVisible();
  await expect(page.getByTestId('cart-button')).toHaveCount(0); // basket emptied

  await page.getByRole('navigation').getByRole('link', { name: 'Мои заказы' }).click();
  await expect(page.getByTestId('my-order').first()).toContainText('Утренний сад × 3, Открытка «Люблю»');
  await page.getByTestId('my-order').first().click();
  await page.getByTestId('cancel-order').click();
  await page.getByRole('button', { name: 'Отменить заказ' }).last().click();
  await expect(page.getByText('Отменён вами').first()).toBeVisible();
});

test('taken time is clearly marked and cannot be chosen', async ({ page, browser }) => {
  await openOrderForm(page);
  const { slot, time } = await firstFreeSlot(page);
  await slot.click();
  await fillCustomer(page, 'Первый');
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await openOrderForm(other);
  const taken = other.getByTestId(`slot-${time}`);
  await expect(taken).toHaveAttribute('data-state', 'busy');
  await expect(taken).toContainText('Занято');
  await expect(taken).toHaveAttribute('aria-label', /занято/);
  await taken.click({ force: true });
  await expect(taken).toHaveAttribute('aria-pressed', 'false');
  await other.context().close();
});

test('two people confirm the same time at once — only one order succeeds', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await openOrderForm(a);
  await openOrderForm(b);
  const { time } = await firstFreeSlot(a);
  for (const p of [a, b]) {
    await p.getByTestId(`slot-${time}`).click();
    await fillCustomer(p, p === a ? 'Алиса' : 'Борис');
  }
  await Promise.all([a.getByTestId('submit-order').click(), b.getByTestId('submit-order').click()]);
  const count = async (re: string | RegExp) => (await a.getByText(re).count()) + (await b.getByText(re).count());
  await expect.poll(() => count('Заказ оформлен!')).toBe(1);
  await expect.poll(() => count(/только что заняли/)).toBe(1);
  await a.context().close();
  await b.context().close();
});

test('pressing «Подтвердить» repeatedly creates one order', async ({ page }) => {
  await openOrderForm(page);
  const { slot } = await firstFreeSlot(page);
  await slot.click();
  await fillCustomer(page, 'Нетерпеливый');
  const btn = page.getByTestId('submit-order');
  // three presses within the same moment, faster than any re-render
  await btn.evaluate((b: HTMLElement) => { b.click(); b.click(); b.click(); });
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();
  await page.goto(`${SHOP}/orders`);
  await expect(page.getByTestId('my-order')).toHaveCount(1);
});

test('the earliest delivery is one hour from now', async ({ page }) => {
  await openOrderForm(page);
  await expect(page.getByText(/Ближайшая доставка — не раньше \d\d:\d\d \(через час/)).toBeVisible();
  const today = await page.locator('.day-chip').first();
  if (await today.isDisabled()) test.skip(true, 'shop closed today');
  await today.click();
  const nowPlus60 = await page.evaluate(() => {
    const t = new Date(Date.now() + 60 * 60_000);
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(t);
  });
  const slots = await page.locator('.slot').evaluateAll((els) => els.map((e) => ({ time: e.getAttribute('data-testid')!.slice(5), state: e.getAttribute('data-state') })));
  for (const s of slots) {
    if (s.time < nowPlus60) expect(s.state, s.time).toBe('too-soon');
    else expect(s.state, s.time).not.toBe('too-soon');
  }
});

test('form explains what is missing', async ({ page }) => {
  await openOrderForm(page);
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Проверьте заполненные поля')).toBeVisible();
  await expect(page.getByText('Укажите имя')).toBeVisible();
  await expect(page.getByText('Выберите время доставки')).toBeVisible();
});

test('basket suggests a postcard when there is none; a postcard alone cannot be ordered', async ({ page }) => {
  await openOrderForm(page, 'white-tulips');
  await expect(page.getByRole('heading', { name: 'Не забыли открытку?' })).toBeVisible();
  await page.getByTestId('card-option-card-kraft').click();
  await page.getByTestId('add-offered-card').click();
  await expect(page.getByTestId('cart-line-card-kraft')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Не забыли открытку?' })).toHaveCount(0);
  // remove the bouquet: only the postcard is left
  await page.getByRole('button', { name: 'Убрать Белые тюльпаны' }).click();
  await expect(page.getByText('Добавьте букет').first()).toBeVisible();
  await page.getByRole('button', { name: 'Убрать Крафт-открытка' }).click();
  await expect(page.getByText('В корзине пока пусто')).toBeVisible();
});

test('balloons can be ordered on their own, with a postcard', async ({ page }) => {
  await page.goto(`${SHOP}/b/balloons-pastel`);
  await page.getByTestId('card-option-card-birthday').click();
  await page.getByLabel('Текст открытки').fill('Ура!');
  await page.getByTestId('add-to-cart').click();
  await page.goto(`${SHOP}/order`);
  await expect(page.getByText('Воздушные шары').first()).toBeVisible();
  await page.getByTestId(`day-${tomorrow()}`).click();
  const { slot } = await firstFreeSlot(page);
  await slot.click();
  await fillCustomer(page, 'Шарик Тестов');
  // 1750 + 250, delivery 400 (below the free-delivery threshold)
  await expect(page.getByTestId('total')).toHaveText(/2\s400 ₽/);
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();
  await expect(page.getByTestId('order-item')).toHaveCount(2);
});
