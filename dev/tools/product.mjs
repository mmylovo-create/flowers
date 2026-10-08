import { chromium, devices } from 'playwright-core';
import sharp from 'sharp';
const [, , base, out] = process.argv;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const shots = [];
for (const kind of ['mobile', 'desktop']) {
  const ctx = await b.newContext(kind === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(base + '#/s/demo/b/pion-cloud', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.getByTestId('card-option-card-love').click();
  await p.getByLabel('Текст открытки').fill('С днём рождения, мама!');
  if (kind === 'mobile') {
    shots.push(await p.screenshot());
    await p.getByTestId('card-offer').scrollIntoViewIfNeeded();
    shots.push(await p.screenshot());
  } else shots.push(await p.screenshot());
  await p.getByTestId('add-to-cart').click();
  await p.waitForTimeout(300);
  shots.push(await p.screenshot());
  await p.goto(base + '#/s/demo/order', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  shots.push(await p.screenshot());
  await ctx.close();
}
const tiles = await Promise.all(shots.map((s) => sharp(s).resize({ height: 700 }).toBuffer()));
const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
let x = 0; const comp = [];
for (let i = 0; i < tiles.length; i++) { comp.push({ input: tiles[i], left: x, top: 0 }); x += metas[i].width + 10; }
await sharp({ create: { width: x, height: 700, channels: 3, background: '#333' } }).composite(comp).png().toFile(out);
await b.close();
