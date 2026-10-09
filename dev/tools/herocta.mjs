// node dev/tools/herocta.mjs <base> <out.png> [width] — is the hero button label on top of the real glass lens?
import { chromium } from 'playwright-core';
const [, , base, out, w = '1280'] = process.argv;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: Number(w), height: 860 } })).newPage();
await p.goto(`${base}/s/demo/?glass=force`, { waitUntil: 'networkidle' });
await p.locator('.hero__cta.glass--gl').waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => {
  const l = document.querySelector('.hero__cta-label'); const r = l.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return `label on top: ${l.contains(hit) || hit === l} (hit ${hit?.tagName}.${hit?.className?.baseVal ?? hit?.className})`;
}));
await p.locator('#hero-media').screenshot({ path: out });
await b.close();
