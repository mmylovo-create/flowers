import { chromium, devices } from 'playwright-core';
import sharp from 'sharp';
const [, , url, out, kind = 'mobile', n = '6'] = process.argv;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext(kind === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
const logs = [];
p.on('pageerror', e => logs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|fonts/.test(m.text())) logs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const vh = await p.evaluate(() => innerHeight);
const shots = [];
for (let i = 0; i < Number(n); i++) {
  shots.push(await p.screenshot());
  await p.mouse.wheel(0, vh * 0.85);
  await p.waitForTimeout(900);
}
const meta = await sharp(shots[0]).metadata();
const w = Math.round(meta.width / 2), h = Math.round(meta.height / 2);
const tiles = await Promise.all(shots.map(s => sharp(s).resize(w, h).toBuffer()));
await sharp({ create: { width: w * tiles.length + 10 * (tiles.length - 1), height: h, channels: 3, background: '#333' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * (w + 10), top: 0 }))).png().toFile(out);
console.log(logs.join('\n') || 'no errors');
await b.close();
