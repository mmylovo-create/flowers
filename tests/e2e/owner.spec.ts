import { expect, test } from '@playwright/test';
import { botUpdate, fillCustomer, firstFreeSlot, openOrderForm, ownerLogin, SHOP, telegramLog } from './helpers';

test('order reaches the cabinet and the Telegram bot; owner manages the shop from both', async ({ page, browser }, info) => {
  const chat = info.project.name === 'phone' ? 7001 : 7002;
  // owner connects Telegram from the cabinet
  await ownerLogin(page);
  await page.getByRole('button', { name: 'Telegram' }).click();
  await page.getByRole('button', { name: 'Подключить Telegram' }).click();
  const code = (await page.locator('code').filter({ hasText: '/start' }).innerText()).split(' ')[1];
  await botUpdate({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, text: `/start ${code}` } });
  expect((await telegramLog()).some((m) => m.payload.chat_id === chat && /подключён/.test(String(m.payload.text)))).toBe(true);

  // a customer orders
  const customer = await (await browser.newContext()).newPage();
  await openOrderForm(customer, 'lavender-mood');
  const { slot } = await firstFreeSlot(customer);
  await slot.click();
  await fillCustomer(customer, 'Ольга Заказова');
  await customer.getByTestId('submit-order').click();
  const heading = await customer.getByRole('heading', { name: /Заказ №\d+/ }).innerText();
  const number = heading.match(/\d+/)![0];

  // …it is in the bot with action buttons
  await expect.poll(async () => (await telegramLog()).find((m) => m.payload.chat_id === chat && String(m.payload.text).includes(`Новый заказ №${number}`))).toBeTruthy();
  const msg = (await telegramLog()).find((m) => m.payload.chat_id === chat && String(m.payload.text).includes(`Новый заказ №${number}`))!;
  expect(String(msg.payload.text)).toContain('Ольга Заказова');
  const confirm = (msg.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0][0];
  expect(confirm.text).toMatch(/Подтвердить/);

  // …and in the cabinet
  await page.getByRole('button', { name: 'Заказы' }).click();
  const card = page.getByTestId('owner-order').filter({ hasText: `№${number}` });
  await expect(card).toContainText('Ольга Заказова');
  await expect(card).toContainText('Новый');
  // owner confirms in Telegram → cabinet and customer see it
  await botUpdate({ update_id: 2, callback_query: { id: 'cb', from: { id: chat }, message: { message_id: 5, chat: { id: chat, type: 'private' } }, data: confirm.callback_data } });
  await page.reload();
  await page.getByRole('button', { name: 'Заказы' }).click();
  await expect(page.getByTestId('owner-order').filter({ hasText: `№${number}` })).toContainText('Подтверждён');
  await customer.reload();
  await expect(customer.getByText('Подтверждён').first()).toBeVisible();

  // price through the bot → site and assistant use it
  const price = info.project.name === 'phone' ? 3333 : 3444;
  await botUpdate({ update_id: 3, message: { message_id: 2, chat: { id: chat, type: 'private' }, text: `/price white-tulips ${price}` } });
  await customer.goto(`${SHOP}/bouquets`);
  await expect(customer.getByTestId('bouquet-white-tulips')).toContainText(new RegExp(`${String(price).slice(0, 1)}\\s${String(price).slice(1)} ₽`));
  await customer.goto(`${SHOP}/`);
  await customer.getByLabel('Ваш вопрос').fill('Сколько стоят белые тюльпаны?');
  await customer.getByRole('button', { name: 'Спросить' }).click();
  await expect(customer.getByTestId('assistant-answer')).toContainText(new RegExp(`Белые тюльпаны.+${String(price).slice(0, 1)}\\s${String(price).slice(1)} ₽`));

  // stock switch in the cabinet → «Нет в наличии» on the site
  await page.getByRole('button', { name: 'Товары и наличие' }).click();
  const sw = page.getByTestId('owner-bouquet-peach-box').getByRole('switch');
  await sw.click();
  await customer.goto(`${SHOP}/bouquets`);
  await expect(customer.getByTestId('bouquet-peach-box')).toContainText('Нет в наличии');
  await sw.click(); // back in stock for the next run
  await customer.context().close();
});

test('owner edits shop details in the cabinet', async ({ page }, info) => {
  await ownerLogin(page);
  await page.getByRole('button', { name: 'Магазин' }).click();
  const address = info.project.name === 'phone' ? 'Москва, ул. Покровка, 19' : 'Москва, ул. Покровка, 21';
  await page.getByLabel('Адрес', { exact: true }).fill(address);
  await page.getByTestId('save-settings').click();
  await expect(page.getByText('Сохранено — изменения уже на сайте.')).toBeVisible();
  await page.goto(`${SHOP}/`);
  await expect(page.getByText(address).first()).toBeVisible();
});

test('cabinet requires the owner password', async ({ page }) => {
  await page.goto(`${SHOP}/admin`);
  await page.getByLabel('Почта').fill('owner@demo.local');
  await page.getByLabel('Пароль').fill('wrong');
  await page.getByTestId('login').click();
  await expect(page.getByText('Неверная почта или пароль')).toBeVisible();
});
