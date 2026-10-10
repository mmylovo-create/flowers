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
  await pickDay(page, tomorrow());
  await expect(page.locator('.slot').first()).toBeVisible();
}

/** Clicks a day in the week calendar, paging forward a week at a time until it is shown. */
export async function pickDay(page: Page, iso: string) {
  const day = page.getByTestId(`day-${iso}`);
  // wait until busy times are loaded and the calendar has settled on its first day
  await expect(page.locator('.slot').first()).toBeVisible();
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) await page.getByTestId('week-next').click();
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
}

export async function fillAddress(page: Page, street = 'ул. Пушкина', house = '10', flat = '5') {
  await expect(page.getByTestId('addr-city')).not.toHaveValue('');
  await page.getByTestId('addr-street').fill(street);
  await page.getByTestId('addr-house').fill(house);
  await page.getByTestId('addr-flat').fill(flat);
}

/** The first free time on the chosen day; when that day is fully booked, moves on day by day. */
export async function firstFreeSlot(page: Page) {
  const slot = page.locator('.slot[data-state="free"]').first();
  await expect(page.locator('.slot').first()).toBeVisible();
  for (let i = 0; i < 14 && !(await slot.count()); i++) {
    const cur = (await page.locator('.cal__day[aria-pressed="true"]').getAttribute('data-testid'))!.slice(4);
    const next = new Date(Date.parse(cur + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    const cell = page.getByTestId(`day-${next}`);
    if (!(await cell.isVisible())) await page.getByTestId('week-next').click();
    if (await cell.isDisabled()) { await page.getByTestId(`day-${new Date(Date.parse(next + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)}`).click(); continue; }
    await cell.click();
  }
  const time = (await slot.getAttribute('data-testid'))!.replace('slot-', '');
  return { slot, time };
}

export async function fillCustomer(page: Page, name = 'Анна Тестова') {
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Телефон').fill('+7 999 111-22-33');
  await page.getByLabel('Ник в Telegram').fill('@anna_test');
  await fillAddress(page);
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
