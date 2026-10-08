import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
console.log(await p.evaluate(() => [...document.querySelectorAll('.bottom-nav, .bottom-nav a, .hero__cta')].map((e) => {
  const s = getComputedStyle(e);
  return `${e.className.slice(0, 40)} | pe=${s.pointerEvents} vis=${s.visibility} op=${s.opacity} z=${s.zIndex} pos=${s.position} inline="${e.getAttribute('style') ?? ''}"`;
}).join('\n')));
await b.close();
