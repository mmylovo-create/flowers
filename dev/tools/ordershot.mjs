// node dev/tools/ordershot.mjs <base> <outPrefix> <width> — the delivery date/time step on a given screen width
import { chromium } from 'playwright-core';
const [, , base, out, w] = process.argv;
const width = Number(w);
const mobile = width < 700;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Europe/Moscow', locale: 'ru-RU' });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error' && !/fonts|TUNNEL/.test(m.text())) console.log('console error:', m.text()); });
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(`${base}/s/demo/b/morning-garden`, { waitUntil: 'networkidle' });
await p.getByTestId('add-to-cart').click();
await p.goto(`${base}/s/demo/order`, { waitUntil: 'networkidle' });
await p.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => /Дата и время/.test(x.textContent)); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 80); });
await p.waitForTimeout(1200);
const info = await p.evaluate(() => {
  const g = document.querySelector('.slot-grid');
  const slots = [...document.querySelectorAll('.slot')];
  const r = g?.getBoundingClientRect();
  return { slots: slots.length, free: slots.filter((s) => s.dataset.state === 'free').length, grid: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'none',
    selectedDay: document.querySelector('.day-chip[aria-pressed=true]')?.textContent, text: document.querySelector('[aria-label="Время доставки"]')?.parentElement?.innerText.slice(0, 300) };
});
console.log(JSON.stringify(info));
await p.screenshot({ path: `${out}-${w}.png` });
await b.close();
