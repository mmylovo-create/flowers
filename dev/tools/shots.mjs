// Usage: node dev/tools/shots.mjs <base> <outDir> [width=390]
// Screenshots of the screens touched by the current change, on a phone.
import { chromium } from 'playwright-core';
const [, , base, out, w = '390'] = process.argv;
const width = Number(w);
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const p = await ctx.newPage();
const shot = async (name) => { await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${w}-${name}.png` }); };
await p.goto(`${base}/s/demo/`, { waitUntil: 'networkidle' }); await shot('home');
await p.evaluate(() => window.scrollTo(0, 900)); await shot('home-scrolled');
await p.goto(`${base}/s/demo/catalog`, { waitUntil: 'networkidle' }); await p.waitForSelector('[data-testid^=section-]'); await shot('catalog');
await p.evaluate(() => window.scrollTo(0, 1400)); await shot('catalog-scrolled');
await p.goto(`${base}/s/demo/advance`, { waitUntil: 'networkidle' });
await p.getByText('Скидки от количества').scrollIntoViewIfNeeded(); await shot('advance');
const contact = p.getByTestId('advance-contact');
if (await contact.count()) { await contact.click(); await shot('advance-contact'); await p.keyboard.press('Escape'); }
await p.goto(`${base}/s/demo/account`, { waitUntil: 'networkidle' }); await p.waitForSelector('input[type=email]'); await shot('account');
await p.goto(`${base}/s/demo/catalog/fireworks`, { waitUntil: 'networkidle' }); await p.waitForSelector('[data-testid^=section-]'); await shot('fireworks');
await p.goto(`${base}/s/demo/admin`, { waitUntil: 'networkidle' });
await p.waitForSelector('input[type=email]', { timeout: 15000 }).catch(() => {});
const email = p.locator('input[type=email]');
if (await email.count()) {
  await email.fill('owner@demo.local'); await p.locator('input[type=password]').fill('flowers-demo');
  await p.getByTestId('login').click(); await p.getByText('Товары и наличие').first().waitFor({ timeout: 15000 });
}
await shot('admin');
await p.getByText('Товары и наличие').first().click();
await p.getByRole('button', { name: 'Добавить товар' }).click().catch(() => {});
await shot('admin-dialog');
await p.evaluate(() => { const d = document.querySelector('[role=dialog]'); d?.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 4) e.scrollTop = e.scrollHeight; }); });
await shot('admin-dialog-bottom');
await b.close();
