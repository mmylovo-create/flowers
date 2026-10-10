// node dev/tools/checkout.mjs <base> <outPrefix> <width> — date picker, nearest time, address, removal
import { chromium } from 'playwright-core';
const [, , base, out, w = '390'] = process.argv;
const width = Number(w); const mobile = width < 700;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })).newPage();
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.route('https://suggest-maps.yandex.ru/**', (r) => r.fulfill({ json: { results: [
  { title: { text: 'улица Покровка, 17' }, subtitle: { text: 'Москва' }, address: { component: [{ name: 'Москва', kind: ['LOCALITY'] }, { name: 'улица Покровка', kind: ['STREET'] }, { name: '17', kind: ['HOUSE'] }] } },
  { title: { text: 'Покровский бульвар' }, subtitle: { text: 'Москва' }, address: { component: [{ name: 'Москва', kind: ['LOCALITY'] }, { name: 'Покровский бульвар', kind: ['STREET'] }] } },
] } }));
await p.goto(`${base}/s/demo/b/pion-cloud`, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /В корзину/ }).first().click();
await p.goto(`${base}/s/demo/order`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const shot = async (name, loc) => { await p.waitForTimeout(400); await (loc ? loc.screenshot({ path: `${out}-${w}-${name}.png` }) : p.screenshot({ path: `${out}-${w}-${name}.png` })); };
const step2 = p.locator('section, div').filter({ has: p.getByRole('heading', { name: '2. Дата и время доставки' }) }).last();
await p.getByRole('heading', { name: '2. Дата и время доставки' }).scrollIntoViewIfNeeded();
await shot('step2', step2);
await p.getByTestId('week-next').click();
const firstOpenNextWeek = p.locator('.cal__day[data-state=open]').first();
await firstOpenNextWeek.click();
await shot('step2-nextweek', step2);
await p.getByTestId('pick-nearest').click();
console.log('chosen:', await p.getByTestId('chosen-day').textContent());
await p.getByTestId('addr-street').fill('Покров');
await p.waitForTimeout(800);
const step3 = p.locator('section, div').filter({ has: p.getByRole('heading', { name: '3. Ваши данные' }) }).last();
await p.getByTestId('addr-street').scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, 200));
await shot('address-suggest');
await p.getByRole('option').first().locator('button').click();
console.log('address:', await p.getByTestId('addr-street').inputValue(), '|', await p.getByTestId('addr-house').inputValue(), '|', await p.getByTestId('addr-city').inputValue());
// removal with undo
await p.evaluate(() => window.scrollTo(0, 0));
await p.getByRole('button', { name: /Меньше: Пионовое облако/ }).click();
await p.waitForTimeout(600);
await shot('removed');
await p.getByTestId('undo-remove').click();
await p.waitForTimeout(500);
console.log('after undo lines:', await p.locator('[data-testid^=cart-line-]').count());
await p.getByTestId('submit-order').scrollIntoViewIfNeeded();
await shot('confirm');
await b.close();
