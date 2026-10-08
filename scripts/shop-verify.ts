// pnpm shop:verify <slug> [--url https://site/s/<slug>/] — opens the published shop like a
// visitor on a phone and on a computer and checks what matters: the page and its data,
// order form with time slots, glass navigation, the install manifest, icons and the
// service worker (Chrome's own installability verdict). Creates no orders.
import { chromium, devices } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTenant, ROOT } from './lib/tenants.ts';

const slug = process.argv[2];
const urlArg = process.argv.indexOf('--url');
const state = existsSync(join(ROOT, '.publish/state.json')) ? JSON.parse(readFileSync(join(ROOT, '.publish/state.json'), 'utf8')) : {};
const url = (urlArg > 0 ? process.argv[urlArg + 1] : state.siteUrl ? `${String(state.siteUrl).replace(/\/$/, '')}/s/${slug}/` : '');
if (!slug || !url) {
  console.error('Использование: pnpm shop:verify <название> [--url https://адрес/s/<название>/]');
  process.exit(1);
}
const t = loadTenant(slug);
const out = join(ROOT, 'verify-output', slug);
mkdirSync(out, { recursive: true });
const results: { ok: boolean; what: string }[] = [];
const ok = (what: string, cond: boolean) => { results.push({ ok: cond, what }); console.log(`${cond ? '✅' : '❌'} ${what}`); };

const exe = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : {});
try {
  for (const [label, opts] of [['телефон', { ...devices['iPhone 13'] }], ['компьютер', { viewport: { width: 1280, height: 860 } }]] as const) {
    const ctx = await browser.newContext({ ...opts, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(url, { waitUntil: 'networkidle' });
    ok(`[${label}] страница открывается (${res?.status()})`, res?.ok() ?? false);
    ok(`[${label}] название «${t.settings.name}»`, await page.getByRole('heading', { level: 1, name: t.settings.name }).isVisible());
    ok(`[${label}] кнопка «Записаться» на главном фото`, await page.getByTestId('hero-cta').isVisible());
    ok(`[${label}] нижняя навигация`, await page.getByRole('navigation', { name: 'Основная навигация' }).isVisible());
    const sample = await page.getByText('Это образец магазина').count();
    ok(`[${label}] магазин принимает настоящие заказы (не образец)`, sample === 0);
    await page.screenshot({ path: join(out, `${label === 'телефон' ? 'phone' : 'desktop'}-home.png`) });
    await page.goto(new URL('order', url).toString(), { waitUntil: 'networkidle' });
    ok(`[${label}] форма заказа показывает время доставки`, (await page.locator('.slot').count()) > 0 || (await page.getByText('В этот день доставки нет').count()) > 0);
    await page.screenshot({ path: join(out, `${label === 'телефон' ? 'phone' : 'desktop'}-order.png`), fullPage: false });
    ok(`[${label}] без ошибок на странице`, errors.length === 0);
    if (label === 'компьютер') {
      await page.goto(url, { waitUntil: 'networkidle' });
      const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
      const manifest = await (await page.request.get(new URL(manifestHref!, url).toString())).json();
      ok('манифест установки: своё имя и адрес /s/<название>/', manifest.name === t.settings.name && manifest.start_url === `/s/${slug}/`);
      let icons = true;
      for (const i of manifest.icons) icons &&= (await page.request.get(new URL(i.src, url).toString())).ok();
      ok('иконки приложения доступны', icons);
      await page.reload({ waitUntil: 'networkidle' });
      const sw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
      ok('service worker для работы без сети', sw);
      const cdp = await ctx.newCDPSession(page);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      ok(`Chrome считает приложение устанавливаемым${installabilityErrors.length ? ': ' + JSON.stringify(installabilityErrors) : ''}`, installabilityErrors.length === 0);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `❌ Не прошло проверок: ${failed}` : '✅ Все проверки пройдены'}. Снимки экрана: verify-output/${slug}/`);
process.exit(failed ? 1 : 0);
