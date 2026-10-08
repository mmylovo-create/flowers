// Local stand-in for Supabase, for development and automated checks.
// Serves the same paths supabase-js uses (rest/v1/rpc, auth/v1, storage/v1, functions/v1)
// on top of real Postgres (PGlite) with the production migrations, plus a fake Telegram API
// so the bot and notifications can be exercised without the internet.
import { createHash, randomUUID } from 'node:crypto';
import { signJwt, verifyJwt, ANON_KEY, SERVICE_KEY, WEBHOOK_SECRET } from './keys.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { LocalDb, RpcError, type Claims } from './pg.ts';
import { createApiHandler, TelegramClient, type Db, type ServerDeps } from '../supabase/functions/_shared/server.ts';
import { createTelegramHandler } from '../supabase/functions/_shared/telegram.ts';
import { loadTenant, tenantStatus } from '../scripts/lib/tenants.ts';

const PORT = Number(process.env.BACKEND_PORT ?? 54321);
const ROOT = join(import.meta.dirname, '..');
const DATA = process.env.BACKEND_DATA ?? join(ROOT, 'dev', '.data');
export const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? 'flowers-demo';
export const BOT_TOKEN = '123456:LOCAL';

export { signJwt, ANON_KEY, SERVICE_KEY, WEBHOOK_SECRET };

const hashPw = (pw: string) => createHash('sha256').update('local:' + pw).digest('hex');

function claimsOf(req: IncomingMessage): Claims {
  const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const p = auth ? verifyJwt(auth) : null;
  if (!p) return { role: 'anon' };
  if (p.role === 'service_role') return { role: 'service_role' };
  if (p.role === 'authenticated' && typeof p.sub === 'string') return { role: 'authenticated', sub: p.sub };
  return { role: 'anon' };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version, x-telegram-bot-api-secret-token',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};
function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { ...CORS, 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer));
}

export interface FakeTelegramMessage { method: string; payload: Record<string, unknown>; at: string }

export async function startBackend(opts: { port?: number; dataDir?: string; siteUrl?: string } = {}) {
  const port = opts.port ?? PORT;
  const dataDir = opts.dataDir ?? DATA;
  mkdirSync(join(dataDir, 'storage'), { recursive: true });
  const db = await LocalDb.create(join(dataDir, 'pg'));
  const base = `http://127.0.0.1:${port}`;
  const tgLog: FakeTelegramMessage[] = [];

  // service-role database client for the server functions
  const serviceDb: Db = {
    rpc: (fn, args = {}) =>
      db.rpc(fn, args, { role: 'service_role' }).then(
        (data) => ({ data, error: null }),
        (e: RpcError) => ({ data: null, error: { message: e.message, code: e.code, details: e.detail } }),
      ),
  };
  const deps: ServerDeps = {
    db: serviceDb,
    telegram: new TelegramClient(BOT_TOKEN, `${base}/fake-telegram`),
    siteUrl: opts.siteUrl ?? 'http://localhost:5173',
    botUsername: 'flowers_local_bot',
    webhookSecret: WEBHOOK_SECRET,
    uploadMedia: async (shopId, path, bytes) => {
      const rel = `shop-media/${shopId}/${path}`;
      const file = join(dataDir, 'storage', rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      return `${base}/storage/v1/object/public/${rel}`;
    },
    log: (...a) => console.error('[server]', ...a),
  };
  const api = createApiHandler(deps);
  const bot = createTelegramHandler(deps);

  // Seed every tenant and its owner account (local only).
  for (const slug of readdirSync(join(ROOT, 'tenants')).filter((d) => !d.startsWith('_'))) {
    if (!existsSync(join(ROOT, 'tenants', slug, 'shop.json'))) continue;
    try {
      const t = loadTenant(slug);
      const mode = tenantStatus(slug).checked ? 'live' : 'sample';
      const r = (await db.rpc('seed_shop', { p: { ...t, mode }, p_overwrite: false }, { role: 'service_role' })) as { id: string };
      if (t.owner.email) {
        const u = await db.pg.query<{ id: string }>(
          `insert into auth.users (email, password) values ($1, $2) on conflict (email) do update set email = excluded.email returning id`,
          [t.owner.email, hashPw(OWNER_PASSWORD)],
        );
        await db.rpc('add_owner', { p_shop: r.id, p_user: u.rows[0].id }, { role: 'service_role' });
      }
    } catch (e) {
      console.error(`tenant ${slug} skipped:`, (e as Error).message);
    }
  }

  const session = (user: { id: string; email: string }) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access_token = signJwt({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp });
    const u = { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: signJwt({ sub: user.id, email: user.email, kind: 'refresh' }), user: u };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', base);
      const p = url.pathname;
      if (req.method === 'OPTIONS') return send(res, 204, null, 'text/plain');

      let m = p.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
      if (m) {
        const raw = req.method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse((await readBody(req)).toString() || '{}');
        try {
          const data = await db.rpc(m[1], raw, claimsOf(req));
          return send(res, 200, data);
        } catch (e) {
          const err = e as RpcError;
          return send(res, err.status, { code: err.code ?? 'P0001', message: err.message, details: err.detail ?? null, hint: null });
        }
      }

      if (p === '/auth/v1/token') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (url.searchParams.get('grant_type') === 'password') {
          const r = await db.pg.query<{ id: string; email: string }>(
            `select id, email from auth.users where email = $1 and password = $2`, [String(body.email ?? '').toLowerCase(), hashPw(String(body.password ?? ''))]);
          if (!r.rows[0]) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
          return send(res, 200, session(r.rows[0]));
        }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const pl = verifyJwt(String(body.refresh_token ?? ''));
          if (!pl) return send(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
          return send(res, 200, session({ id: String(pl.sub), email: String(pl.email) }));
        }
      }
      if (p === '/auth/v1/user') {
        const c = claimsOf(req);
        if (c.role !== 'authenticated') return send(res, 401, { msg: 'unauthorized' });
        const r = await db.pg.query<{ id: string; email: string }>(`select id, email from auth.users where id = $1`, [c.sub]);
        return send(res, 200, session(r.rows[0]).user);
      }
      if (p === '/auth/v1/logout') return send(res, 204, null, 'text/plain');

      m = p.match(/^\/storage\/v1\/object\/public\/(.+)$/);
      if (m && req.method === 'GET') {
        const file = normalize(join(dataDir, 'storage', decodeURIComponent(m[1])));
        if (!file.startsWith(join(dataDir, 'storage')) || !existsSync(file)) return send(res, 404, { message: 'not found' });
        const ext = file.split('.').pop();
        const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
        res.writeHead(200, { ...CORS, 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
        return res.end(readFileSync(file));
      }
      m = p.match(/^\/storage\/v1\/object\/(shop-media)\/(.+)$/);
      if (m && (req.method === 'POST' || req.method === 'PUT')) {
        const c = claimsOf(req);
        const rel = decodeURIComponent(m[2]);
        const shopId = rel.split('/')[0];
        const owner = c.role === 'service_role' || (c.role === 'authenticated' &&
          (await db.pg.query(`select 1 from shop_owners where shop_id::text = $1 and user_id = $2`, [shopId, c.sub])).rows.length > 0);
        if (!owner) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
        const file = normalize(join(dataDir, 'storage', 'shop-media', rel));
        if (!file.startsWith(join(dataDir, 'storage'))) return send(res, 400, { message: 'bad path' });
        mkdirSync(dirname(file), { recursive: true });
        let bytes = await readBody(req);
        const ct = String(req.headers['content-type'] ?? '');
        if (ct.startsWith('multipart/form-data')) bytes = extractMultipartFile(bytes, ct);
        writeFileSync(file, bytes);
        return send(res, 200, { Key: `shop-media/${rel}`, Id: randomUUID() });
      }

      m = p.match(/^\/functions\/v1\/(api|telegram)$/);
      if (m) {
        const body = await readBody(req);
        const r = new Request(base + p, { method: req.method, headers: req.headers as HeadersInit, body: req.method === 'GET' ? undefined : body });
        const out = await (m[1] === 'api' ? api : bot)(r);
        // the handler sets its own CORS headers; merge case-insensitively so none is doubled
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(CORS)) hdrs[k.toLowerCase()] = v;
        out.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
        res.writeHead(out.status, hdrs);
        return res.end(Buffer.from(await out.arrayBuffer()));
      }

      // ── fake Telegram Bot API ──
      if (p === '/fake-telegram/__log') return send(res, 200, tgLog);
      if (p === '/fake-telegram/__reset') { tgLog.length = 0; return send(res, 200, { ok: true }); }
      m = p.match(/^\/fake-telegram\/bot[^/]+\/([A-Za-z]+)$/);
      if (m) {
        const payload = JSON.parse((await readBody(req)).toString() || '{}');
        tgLog.push({ method: m[1], payload, at: new Date().toISOString() });
        if (m[1] === 'getFile') return send(res, 200, { ok: true, result: { file_id: payload.file_id, file_path: 'photos/sample.jpg' } });
        return send(res, 200, { ok: true, result: { message_id: tgLog.length, chat: { id: payload.chat_id } } });
      }
      if (p.startsWith('/fake-telegram/file/')) {
        const sample = join(ROOT, 'tenants', 'demo', 'photos', 'white-tulips.jpg');
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(readFileSync(sample));
      }
      if (p === '/health') return send(res, 200, { ok: true });
      send(res, 404, { message: 'not found: ' + p });
    } catch (e) {
      console.error(e);
      send(res, 500, { message: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { server, db, base, tgLog, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function extractMultipartFile(buf: Buffer, ct: string): Buffer {
  const boundary = '--' + ct.split('boundary=')[1];
  const s = buf.toString('latin1');
  const parts = s.split(boundary).filter((x) => x.includes('\r\n\r\n'));
  const filePart = parts.find((x) => /filename=/.test(x)) ?? parts[parts.length - 1];
  const body = filePart.slice(filePart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return Buffer.from(body, 'latin1');
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const b = await startBackend();
  console.log(`Local backend: ${b.base}`);
  console.log(`  VITE_SUPABASE_URL=${b.base}`);
  console.log(`  Owner login: password "${OWNER_PASSWORD}" for the owner.email in each tenants/<slug>/shop.json`);
}
