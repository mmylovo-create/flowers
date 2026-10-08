// Server functions shared by the Supabase Edge Functions (Deno) and the local backend (Node).
// Only Web APIs are used here; the database client and secrets are passed in.
import {
  AppError, formatPhone, formatRub, formatSlot, orderInputSchema, STATUS_LABELS,
  type OrderView, type PublicShop,
} from './domain/index.ts';
import { answerQuestion } from './assistant.ts';

export interface RpcResult { data: unknown; error: { message: string; code?: string; details?: string } | null }
export interface Db { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult> }

export interface ServerDeps {
  /** Database client with the service role key. Never exposed to browsers. */
  db: Db;
  telegram: TelegramClient | null;
  siteUrl: string;
  botUsername: string;
  webhookSecret: string;
  /** Stores a photo sent to the bot and returns its public URL */
  uploadMedia: (shopId: string, path: string, bytes: Uint8Array, contentType: string) => Promise<string>;
  assistantLlm?: (system: string, question: string) => Promise<string | null>;
  log?: (...a: unknown[]) => void;
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

export async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const code = /^[a-z_]+$/.test(error.message) ? error.message : 'server';
    if (code === 'server') console.error(fn, error);
    throw new AppError(code, error.details);
  }
  return data as T;
}

// ─────────────────────────── public API ───────────────────────────
export function createApiHandler(deps: ServerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_input', message: 'Неверный запрос' }, 400);
    }
    try {
      switch (body.action) {
        case 'create_order': {
          const parsed = orderInputSchema.safeParse(body.order);
          if (!parsed.success) {
            return json({ error: 'invalid_input', message: 'Проверьте заполненные поля', fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 422);
          }
          const order = await call<OrderView & { duplicate: boolean }>(deps.db, 'create_order', { p: parsed.data });
          await deliverOutbox(deps).catch((e) => deps.log?.('outbox', e));
          return json({ order });
        }
        case 'cancel_order': {
          const token = String(body.token ?? '');
          if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'order_not_found', message: new AppError('order_not_found').message }, 404);
          const order = await call<OrderView>(deps.db, 'cancel_order', { p_token: token });
          await deliverOutbox(deps).catch((e) => deps.log?.('outbox', e));
          return json({ order });
        }
        case 'assistant': {
          const slug = String(body.slug ?? '');
          const question = String(body.question ?? '').slice(0, 500);
          const tokens = Array.isArray(body.tokens) ? body.tokens.filter((t) => typeof t === 'string' && /^[a-f0-9]{64}$/.test(t)).slice(0, 20) : [];
          if (!question.trim()) return json({ answer: 'Задайте вопрос — например, «Сколько стоит доставка?»' });
          const answer = await answerQuestion(deps, slug, question, tokens as string[]);
          return json(answer);
        }
        case 'process_outbox': {
          const n = await deliverOutbox(deps);
          return json({ sent: n });
        }
        default:
          return json({ error: 'invalid_input', message: 'Неизвестное действие' }, 400);
      }
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.code, message: e.message }, e.code === 'slot_busy' ? 409 : 400);
      deps.log?.('api error', e);
      return json({ error: 'server', message: 'Что-то пошло не так. Попробуйте ещё раз.' }, 500);
    }
  };
}

// ─────────────────────────── notifications ───────────────────────────
interface OutboxItem {
  id: number; kind: string; order: OrderView | null; shopName: string; shopTimezone: string; slotMinutes: number; shopId: string; chats: number[];
}

export function orderText(o: OrderView, shopName: string, tz: string, slotMinutes: number, kind = 'order_created'): string {
  const head = kind === 'order_cancelled' ? `❌ Клиент отменил заказ №${o.number}` : `🌸 Новый заказ №${o.number}`;
  const lines = [
    `${head} — ${shopName}`,
    ...o.items.map((i) => `${i.kind === 'card' ? '💌' : '💐'} ${i.name} × ${i.quantity} — ${formatRub(i.unitPrice * i.quantity)}${i.note ? `\n   Текст открытки: «${i.note}»` : ''}`),
    `Доставка: ${formatSlot(o.slotStart, tz, slotMinutes)}`,
    `Сумма: ${formatRub(o.price.total)}${o.price.discountPercent ? ` (скидка ${o.price.discountPercent}%)` : ''}${o.price.deliveryFee ? `, доставка ${formatRub(o.price.deliveryFee)}` : ''}`,
    `Клиент: ${o.name}, ${formatPhone(o.phone)}`,
    `Связь: ${o.contactChannel === 'telegram' ? 'Telegram ' + o.contactHandle : 'VK vk.com/' + o.contactHandle}`,
    `Адрес: ${o.address}`,
  ];
  if (o.comment) lines.push(`Комментарий: ${o.comment}`);
  lines.push(`Статус: ${STATUS_LABELS[o.status]}`);
  return lines.join('\n');
}

export function orderButtons(o: OrderView) {
  if (!['new', 'confirmed', 'delivering'].includes(o.status)) return undefined;
  const b = (text: string, st: string) => ({ text, callback_data: `o:${o.id}:${st}` });
  return {
    inline_keyboard: [
      [b('✅ Подтвердить', 'c'), b('🚚 В пути', 'v')],
      [b('🏁 Доставлен', 'd'), b('✖️ Отменить', 'x')],
    ],
  };
}

/** Sends pending notifications to every Telegram chat linked to the shop. Safe to call often. */
export async function deliverOutbox(deps: ServerDeps): Promise<number> {
  const items = await call<OutboxItem[]>(deps.db, 'outbox_take', { p_limit: 20 });
  const done: number[] = [];
  for (const it of items) {
    if (!it.order) { done.push(it.id); continue; }
    if (!deps.telegram || it.chats.length === 0) { done.push(it.id); continue; }
    let ok = true;
    for (const chat of it.chats) {
      try {
        await deps.telegram.send(chat, orderText(it.order, it.shopName, it.shopTimezone, it.slotMinutes, it.kind),
          it.kind === 'order_created' ? orderButtons(it.order) : undefined);
      } catch (e) {
        ok = false;
        deps.log?.('telegram send failed', chat, e);
      }
    }
    if (ok) done.push(it.id);
  }
  if (done.length) await call(deps.db, 'outbox_done', { p_ids: done });
  return done.length;
}

// ─────────────────────────── Telegram ───────────────────────────
export class TelegramClient {
  constructor(private token: string, private apiBase = 'https://api.telegram.org', private f: typeof fetch = fetch) {}

  async api<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
    const r = await this.f(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = (await r.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j.result;
  }

  send(chatId: number, text: string, replyMarkup?: unknown) {
    return this.api('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup, disable_web_page_preview: true });
  }

  async download(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
    const f = await this.api<{ file_path: string }>('getFile', { file_id: fileId });
    const r = await this.f(`${this.apiBase}/file/bot${this.token}/${f.file_path}`);
    if (!r.ok) throw new Error('telegram download failed');
    return { bytes: new Uint8Array(await r.arrayBuffer()), path: f.file_path };
  }
}

export type { PublicShop };
