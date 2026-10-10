import { expect, test } from '@playwright/test';
import { fillCustomer, openOrderForm, SHOP } from './helpers';

test('nearest time is suggested and the week calendar highlights the chosen day', async ({ page }) => {
  await page.goto(`${SHOP}/b/morning-garden`);
  await page.getByTestId('add-to-cart').click();
  await page.goto(`${SHOP}/order`);

  const nearest = page.getByTestId('nearest-slot');
  await expect(nearest).toBeVisible();
  await expect(nearest).toContainText(/\d\d:\d\d–\d\d:\d\d/);
  await page.getByTestId('pick-nearest').click();
  await expect(nearest).toContainText('Выбрано');
  await expect(page.locator('.slot[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.cal__day[aria-pressed="true"]')).toHaveCount(1);

  // next week: the arrow moves the calendar, a click there selects and highlights the day
  const before = await page.locator('.cal__day').first().getAttribute('data-testid');
  await page.getByTestId('week-next').click();
  const after = await page.locator('.cal__day').first().getAttribute('data-testid');
  expect(after).not.toBe(before);
  const day = page.locator('.cal__day[data-state="open"]').first();
  const id = (await day.getAttribute('data-testid'))!;
  await day.click();
  await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cal__day[aria-pressed="true"]')).toHaveCount(1);
  const bg = await page.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByTestId('chosen-day')).toContainText(String(Number(id.slice(-2))));
  // the slot from today is no longer selected
  await expect(page.locator('.slot[aria-pressed="true"]')).toHaveCount(0);
  await page.getByTestId('week-prev').click();
  await expect(page.locator('.cal__day').first()).toHaveAttribute('data-testid', before!);
});

test('address in four fields with Yandex Maps suggestions', async ({ page }) => {
  await page.route('https://suggest-maps.yandex.ru/**', (route) => route.fulfill({
    json: {
      results: [{
        title: { text: 'улица Покровка, 17' }, subtitle: { text: 'Москва' },
        address: { component: [
          { name: 'Москва', kind: ['LOCALITY'] }, { name: 'улица Покровка', kind: ['STREET'] }, { name: '17', kind: ['HOUSE'] },
        ] },
      }],
    },
  }));
  await openOrderForm(page);
  await expect(page.getByTestId('addr-city')).toHaveValue(/\S/);
  await page.getByTestId('addr-street').pressSequentially('Покров', { delay: 30 });
  const option = page.getByRole('option', { name: /улица Покровка, 17/ });
  await expect(option).toBeVisible();
  await expect(page.getByText('Подсказки Яндекс Карт')).toBeVisible();
  await option.click();
  await expect(page.getByTestId('addr-street')).toHaveValue('улица Покровка');
  await expect(page.getByTestId('addr-house')).toHaveValue('17');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByTestId('addr-flat').fill('4');
  await expect(page.getByText(/По адресу: .*улица Покровка, д\. 17, кв\. 4/)).toBeVisible();

  // without a house the order is not sent
  await page.getByTestId('addr-house').fill('');
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Укажите дом')).toBeVisible();
});

test('an item can be removed completely and kept via the notification', async ({ page }) => {
  await openOrderForm(page, 'white-tulips');
  await expect(page.getByTestId('qty-white-tulips')).toHaveText('1');
  await page.getByRole('button', { name: 'Меньше: Белые тюльпаны' }).click();
  await expect(page.getByTestId('cart-line-white-tulips')).toHaveCount(0);
  await expect(page.getByText('«Белые тюльпаны» убран из корзины')).toBeVisible();
  await page.getByTestId('undo-remove').click();
  await expect(page.getByTestId('cart-line-white-tulips')).toBeVisible();
  await expect(page.getByTestId('qty-white-tulips')).toHaveText('1');

  await page.getByTestId('remove-white-tulips').click();
  await expect(page.getByText('В корзине пока пусто')).toBeVisible();
});

test('confirmation says we may contact the customer', async ({ page }) => {
  await openOrderForm(page);
  await expect(page.getByTestId('contact-note')).toHaveText('При необходимости с вами свяжутся по указанным вами контактам');
  await page.locator('.slot[data-state="free"]').first().click();
  await fillCustomer(page, 'Контакт Тестов');
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Заказ оформлен!')).toBeVisible();
  await expect(page.getByText(/При необходимости с вами свяжутся по указанным вами контактам/)).toBeVisible();
});
