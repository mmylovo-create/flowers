import { expect, test } from '@playwright/test';
import { fillCustomer, firstFreeSlot, openOrderForm, SHOP } from './helpers';

test('customer orders a bouquet, sees the details, finds it in «Мои заказы» and cancels it', async ({ page }) => {
  await openOrderForm(page);
  await page.getByRole('button', { name: 'Больше' }).click();
  await page.getByRole('button', { name: 'Больше' }).click();
  await expect(page.getByTestId('qty')).toHaveText('3');
  await expect(page.getByText('Скидка 5% за количество')).toBeVisible();
  const { slot, time } = await firstFreeSlot(page);
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await fillCustomer(page);
  await expect(page.getByTestId('total')).toHaveText(/11\s970 ₽/);
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Заказ №\d+/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`${time}–`)).first()).toBeVisible();
  await expect(page.getByText('Москва, ул. Пушкина, 10, кв. 5')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Мои заказы' }).click();
  await expect(page.getByTestId('my-order').first()).toContainText('Утренний сад × 3');
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
  await expect(page.getByTestId('my-order').filter({ hasText: 'Утренний сад × 1' })).toHaveCount(1);
});

test('the earliest delivery is one hour from now', async ({ page }) => {
  await page.goto(`${SHOP}/order`);
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
