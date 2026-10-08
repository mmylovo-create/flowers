import { chromium, devices } from 'playwright-core';
const [, , url] = process.argv;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
const report = async () => p.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('.bottom-nav a, .hero__cta')) {
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.push(`${a.textContent.trim().slice(0, 12)} -> ${hit ? hit.tagName + '.' + (hit.className?.baseVal ?? hit.className) : 'none'} ${a.contains(hit) ? 'OK' : 'BLOCKED'}`);
  }
  out.push('canvases: ' + [...document.querySelectorAll('canvas')].map((c) => getComputedStyle(c).zIndex + '/' + getComputedStyle(c).pointerEvents + '/' + getComputedStyle(c).position).join(' '));
  return out.join('\n');
});
console.log(await report());
await p.locator('.bottom-nav a', { hasText: 'Каталог' }).click({ timeout: 5000 }).catch((e) => console.log('click failed:', e.message.split('\n')[0]));
await p.waitForTimeout(800);
console.log('url after click:', p.url());
await b.close();
