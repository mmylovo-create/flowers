import { expect, type Page } from '@playwright/test';
import { BACKEND_URL, WEBHOOK_SECRET } from '../../dev/keys.ts';

export const SHOP = '/s/demo';
export const OWNER = { email: 'owner@demo.local', password: 'flowers-demo' };

/** Tomorrow in the shop's time zone (yyyy-MM-dd). */
export function tomorrow(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(Date.now() + 86_400_000));
}

/** Puts a bouquet into the basket from its page, then opens checkout on tomorrow. */
export async function openOrderForm(page: Page, bouquet = 'morning-garden') {
  await page.goto(`${SHOP}/b/${bouquet}`);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByText('Добавлено в корзину')).toBeVisible();
  await page.goto(`${SHOP}/order`);
  await page.getByTestId(`day-${tomorrow()}`).click();
  await expect(page.locator('.slot').first()).toBeVisible();
}

export async function firstFreeSlot(page: Page) {
  const slot = page.locator('.slot[data-state="free"]').first();
  const time = (await slot.getAttribute('data-testid'))!.replace('slot-', '');
  return { slot, time };
}

export async function fillCustomer(page: Page, name = 'Анна Тестова') {
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Телефон').fill('+7 999 111-22-33');
  await page.getByLabel('Ник в Telegram').fill('@anna_test');
  await page.getByLabel('Адрес доставки').fill('Москва, ул. Пушкина, 10, кв. 5');
  await page.getByRole('checkbox', { name: /Подтверждаю доставку/ }).check();
}

export async function telegramLog(): Promise<{ method: string; payload: Record<string, unknown> }[]> {
  return (await fetch(`${BACKEND_URL}/fake-telegram/__log`)).json();
}

export async function botUpdate(update: unknown) {
  const r = await fetch(`${BACKEND_URL}/functions/v1/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    body: JSON.stringify(update),
  });
  expect(r.status).toBe(200);
}

export async function ownerLogin(page: Page) {
  await page.goto(`${SHOP}/admin`);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByTestId('login').click();
  await expect(page.getByRole('heading', { name: /кабинет/ })).toBeVisible();
}
