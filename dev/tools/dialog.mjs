// node dev/tools/dialog.mjs <base> <out.png> <width> [height]
import { chromium } from 'playwright-core';
const [, , base, out, w, h = '800'] = process.argv;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const mobile = Number(w) < 700;
const p = await (await b.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })).newPage();
await p.goto(`${base}/s/demo/admin`, { waitUntil: 'networkidle' });
await p.locator('input[type=email]').fill('owner@demo.local');
await p.locator('input[type=password]').fill('flowers-demo');
await p.getByTestId('login').click();
await p.getByText('Товары и наличие').first().click();
await p.getByRole('button', { name: 'Добавить товар' }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: out });
console.log(await p.evaluate(() => { const d = document.querySelector('dialog[open]'); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); return JSON.stringify({ x: r.x, w: r.width, h: r.height, bg: cs.backgroundColor, sw: d.scrollWidth, cw: d.clientWidth, vw: innerWidth }); }));
await b.close();
