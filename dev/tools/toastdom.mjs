import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const p = await (await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })).newPage();
await p.goto(process.argv[2] + '/s/demo/b/pion-cloud', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /В корзину/ }).first().click();
await p.goto(process.argv[2] + '/s/demo/order', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /Меньше: Пионовое облако/ }).click();
await p.waitForTimeout(600);
console.log(await p.evaluate(() => {
  const t = [...document.querySelectorAll('[class*=toast]')];
  const v = t[0]; let e = v; const chain = []; while (e && e !== document.body) { const cs = getComputedStyle(e); chain.push(e.tagName + '.' + String(e.className).slice(0, 50) + ' pos=' + cs.position + ' bottom=' + cs.bottom + ' z=' + cs.zIndex + ' role=' + e.getAttribute('role') + ' popover=' + e.getAttribute('popover')); e = e.parentElement; } return chain.join('\n'); return t.map((e) => `${e.tagName} ${String(e.className).split(' ').filter((c) => c.startsWith('astryx')).join(' ')} pos=${getComputedStyle(e).position} bottom=${getComputedStyle(e).bottom} z=${getComputedStyle(e).zIndex}`).join('\n');
}));
await b.close();
