import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['iPhone 13'] }); if (process.argv[3] === 'noglass') await ctx.addInitScript(() => { window.__NO_LIQUID_GL__ = true; }); const p = await ctx.newPage();
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
for (const t of [2000, 6000, 12000]) {
  await p.waitForTimeout(t === 2000 ? 2000 : 4000);
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
  const canv = await p.evaluate(() => [...document.querySelectorAll('canvas')].map(c => `${c.width}x${c.height}`).join(' '));
  console.log('t', t, 'fps', fps, 'canvases', canv);
}
await b.close();
