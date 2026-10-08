// pnpm shop:publish <slug> — puts the shop online with the official CLIs:
//   Supabase (database, server functions, secrets), Telegram (webhook), Vercel (site).
// Settings come from .env.publish (see .env.publish.example). Safe to run again:
// migrations are applied once, the shop row is created once (use --overwrite to replace
// cabinet edits with shop.json), the webhook secret is kept in .publish/state.json.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTenant, ROOT, tenantStatus } from './lib/tenants.ts';
import { checkTenant } from './shop-check.ts';

const slug = process.argv[2];
const overwrite = process.argv.includes('--overwrite');
const skipSite = process.argv.includes('--skip-site');
if (!slug) {
  console.error('Использование: pnpm shop:publish <название> [--overwrite] [--skip-site]');
  process.exit(1);
}

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(join(ROOT, '.env.publish'));
const env = (k: string, required = true) => {
  const v = process.env[k] ?? '';
  if (required && !v) {
    console.error(`Не задано ${k}. Заполните .env.publish (образец: .env.publish.example).`);
    process.exit(1);
  }
  return v;
};

const step = (t: string) => console.log(`\n▶ ${t}`);
function run(cmd: string, args: string[], opts: { input?: string; capture?: boolean; env?: Record<string, string> } = {}): string {
  const r = spawnSync(cmd, args, {
    cwd: ROOT, encoding: 'utf8', input: opts.input, env: { ...process.env, ...opts.env },
    stdio: opts.capture ? ['pipe', 'pipe', 'inherit'] : ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    console.error(`\n✖ Команда не выполнилась: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
  return r.stdout ?? '';
}
const supabase = (...a: string[]) => run('pnpm', ['dlx', 'supabase@2', ...a], { capture: true });

// 1. check
step(`Проверяю tenants/${slug}`);
const check = await checkTenant(slug);
for (const w of check.warnings) console.log(`  ⚠️  ${w}`);
if (check.errors.length) {
  for (const e of check.errors) console.log(`  ❌ ${e}`);
  console.error('Сначала исправьте ошибки (pnpm shop:check).');
  process.exit(1);
}
if (!tenantStatus(slug).checked) {
  console.error(`Магазин ещё не проверен: запустите pnpm shop:check ${slug}`);
  process.exit(1);
}
const tenant = loadTenant(slug);

const REF = env('SUPABASE_PROJECT_REF');
env('SUPABASE_ACCESS_TOKEN');
const DB_PASSWORD = env('SUPABASE_DB_PASSWORD');
const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN', false);
const BOT_USERNAME = env('TELEGRAM_BOT_USERNAME', false).replace(/^@/, '');
const SUPABASE_URL = `https://${REF}.supabase.co`;

mkdirSync(join(ROOT, '.publish'), { recursive: true });
const statePath = join(ROOT, '.publish', 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state.webhookSecret ??= randomBytes(24).toString('hex');
state.siteUrl ??= process.env.SITE_URL ?? '';
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
save();

// 2. database + functions
step('Supabase: привязка проекта и миграции базы');
supabase('link', '--project-ref', REF, '--password', DB_PASSWORD);
supabase('db', 'push', '--password', DB_PASSWORD);

step('Supabase: ключи проекта');
const keys = JSON.parse(supabase('projects', 'api-keys', '--project-ref', REF, '-o', 'json')) as { name: string; api_key: string; type?: string }[];
const anonKey = process.env.SUPABASE_ANON_KEY || (keys.find((k) => k.name === 'anon') ?? keys.find((k) => k.type === 'publishable'))?.api_key || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || (keys.find((k) => k.name === 'service_role') ?? keys.find((k) => k.type === 'secret'))?.api_key || '';
if (!anonKey || !serviceKey) {
  console.error('Не удалось получить ключи anon/service_role.');
  process.exit(1);
}

async function rest<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

// 3. site first (its address goes into the server functions and the bot)
let siteUrl: string = state.siteUrl;
if (!skipSite) {
  step('Vercel: публикация сайта');
  const vercelArgs = ['dlx', 'vercel@latest', 'deploy', '--prod', '--yes',
    '--build-env', `VITE_SUPABASE_URL=${SUPABASE_URL}`,
    '--build-env', `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    '--build-env', `VITE_TELEGRAM_BOT=${BOT_USERNAME}`,
    '--build-env', `VITE_DEFAULT_SHOP=${process.env.DEFAULT_SHOP ?? slug}`];
  if (process.env.VERCEL_TOKEN) vercelArgs.push('--token', process.env.VERCEL_TOKEN);
  if (process.env.VERCEL_SCOPE) vercelArgs.push('--scope', process.env.VERCEL_SCOPE);
  const out = run('pnpm', vercelArgs, { capture: true });
  const deployed = out.match(/https:\/\/[^\s]+\.vercel\.app/g)?.pop();
  siteUrl = process.env.SITE_URL || state.siteUrl || deployed || '';
  if (!process.env.SITE_URL && deployed && !state.siteUrl) {
    // the stable production alias is <project>.vercel.app; Vercel prints it as "Aliased"
    const alias = out.match(/Aliased:\s+(https:\/\/\S+)/)?.[1];
    siteUrl = alias ?? deployed;
  }
  state.siteUrl = siteUrl;
  save();
}

step('Supabase: секреты и серверные функции');
const secrets = [`TELEGRAM_WEBHOOK_SECRET=${state.webhookSecret}`, `SITE_URL=${siteUrl}`];
if (BOT_TOKEN) secrets.push(`TELEGRAM_BOT_TOKEN=${BOT_TOKEN}`, `TELEGRAM_BOT_USERNAME=${BOT_USERNAME}`);
if (process.env.ANTHROPIC_API_KEY) secrets.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
supabase('secrets', 'set', '--project-ref', REF, ...secrets);
supabase('functions', 'deploy', 'api', '--project-ref', REF, '--no-verify-jwt');
supabase('functions', 'deploy', 'telegram', '--project-ref', REF, '--no-verify-jwt');

// 4. shop data + owner account
step(`База: магазин «${tenant.settings.name}»`);
const seeded = await rest<{ id: string; created: boolean }>('/rest/v1/rpc/seed_shop', { p: { ...tenant, mode: 'live' }, p_overwrite: overwrite });
console.log(seeded.created ? '  создан' : overwrite ? '  перезаписан из shop.json' : '  уже был — данные из кабинета сохранены');

let ownerPassword = '';
if (tenant.owner.email) {
  step(`Кабинет: вход для ${tenant.owner.email}`);
  const list = await rest<{ users: { id: string; email: string }[] }>(`/auth/v1/admin/users?per_page=1000`, undefined, 'GET');
  let user = list.users.find((u) => u.email?.toLowerCase() === tenant.owner.email.toLowerCase());
  if (!user) {
    ownerPassword = process.env.OWNER_PASSWORD || randomBytes(9).toString('base64url');
    user = await rest<{ id: string; email: string }>('/auth/v1/admin/users', { email: tenant.owner.email, password: ownerPassword, email_confirm: true });
  }
  await rest('/rest/v1/rpc/add_owner', { p_shop: seeded.id, p_user: user.id });
}

// 5. Telegram
if (BOT_TOKEN) {
  step('Telegram: вебхук и команды бота');
  const tg = (m: string, b: unknown) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  }).then((r) => r.json() as Promise<{ ok: boolean; description?: string }>);
  const wh = await tg('setWebhook', { url: `${SUPABASE_URL}/functions/v1/telegram`, secret_token: state.webhookSecret, allowed_updates: ['message', 'callback_query'] });
  if (!wh.ok) console.error('  setWebhook:', wh.description);
  await tg('setMyCommands', { commands: [
    { command: 'orders', description: 'Ближайшие заказы' },
    { command: 'bouquets', description: 'Наличие и цены' },
    { command: 'add', description: 'Добавить букет с фото' },
    { command: 'site', description: 'Ссылки на сайт и кабинет' },
  ] });
}

const shopUrl = `${siteUrl.replace(/\/$/, '')}/s/${slug}/`;
console.log(`
✅ Готово.
  Сайт:     ${shopUrl}
  Кабинет:  ${shopUrl}admin${tenant.owner.email ? `  (вход: ${tenant.owner.email}${ownerPassword ? `, пароль: ${ownerPassword} — сохраните его` : ', пароль прежний'})` : ''}
  Бот:      ${BOT_USERNAME ? `https://t.me/${BOT_USERNAME} — подключите чат в кабинете → Telegram` : 'не настроен (нет TELEGRAM_BOT_TOKEN)'}

Проверьте ссылку: pnpm shop:verify ${slug}`);

try {
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/shop-verify.ts', slug, '--url', shopUrl], { cwd: ROOT, stdio: 'inherit' });
} catch {
  process.exitCode = 1;
}
