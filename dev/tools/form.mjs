import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const p = await (await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })).newPage();
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.getByRole('heading', { name: '3. Ваши данные' }).scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
await p.screenshot({ path: process.argv[3] });
await b.close();
