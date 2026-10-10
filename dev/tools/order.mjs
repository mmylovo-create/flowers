// node dev/tools/order.mjs <base> <outPrefix> <width> — basket + delivery screens
import { chromium } from 'playwright-core';
const [, , base, out, w = '1280'] = process.argv;
const width = Number(w); const mobile = width < 700;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })).newPage();
p.on('console', (m) => { if (m.type() === 'error' && !/fonts|TUNNEL/.test(m.text())) console.log('console error:', m.text()); });
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(`${base}/s/demo/b/pion-cloud`, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /В корзину/ }).first().click();
await p.goto(`${base}/s/demo/order`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const h = p.getByRole('heading', { name: '2. Дата и время доставки' });
await h.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -80));
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}-${w}-slots.png` });
console.log(await p.evaluate(() => {
  const g = document.querySelector('.slot-grid'); const r = g?.getBoundingClientRect();
  return JSON.stringify({ grid: !!g, slots: document.querySelectorAll('.slot').length, free: document.querySelectorAll('.slot[data-state=free]').length, gridH: r?.height, chips: document.querySelectorAll('.day-chip').length, pressed: document.querySelector('.day-chip[aria-pressed=true]')?.textContent });
}));
await b.close();
