// Data access for the shop pages. A live shop talks to Supabase (database functions for reads,
// our server function for orders and the assistant). A sample shop (not yet checked with
// `pnpm shop:check`) runs entirely on this device and never sends orders anywhere.
import { addDays } from 'date-fns';
import {
  canCancel, cancelDeadline, errorMessage, localDay, orderInputSchema, priceOrder, validateSlot,
  type OrderInput, type OrderView, type PublicShop,
} from '@domain';
import { answerQuestion } from '@server/assistant.ts';
import type { Db } from '@server/server.ts';
import { supabase } from './supabase';
import type { BundledTenant } from './tenantTypes';

export class ApiError extends Error {
  constructor(public code: string, message?: string, public fields: { path: string; message: string }[] = []) {
    super(message ?? errorMessage(code));
  }
}

export type CreatedOrder = OrderView & { duplicate: boolean };

export interface ShopApi {
  shop(slug: string): Promise<PublicShop>;
  busy(slug: string, from: string, to: string): Promise<Record<string, number>>;
  createOrder(input: OrderInput): Promise<CreatedOrder>;
  cancelOrder(token: string): Promise<OrderView>;
  orders(tokens: string[]): Promise<OrderView[]>;
  order(token: string): Promise<OrderView | null>;
  ask(slug: string, question: string, tokens: string[]): Promise<{ answer: string }>;
}

// ───────────────────────── live ─────────────────────────
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) {
    if (/fetch|network/i.test(error.message)) throw new ApiError('network');
    throw new ApiError(/^[a-z_]+$/.test(error.message) ? error.message : 'server');
  }
  return data as T;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('api', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json().catch(() => null) as { error?: string; message?: string; fields?: ApiError['fields'] } | null;
      if (j?.error) throw new ApiError(j.error, j.message, j.fields ?? []);
    }
    throw new ApiError('network');
  }
  return data as T;
}

export const liveApi: ShopApi = {
  async shop(slug) {
    const s = await rpc<PublicShop | null>('shop_public', { p_slug: slug });
    if (!s) throw new ApiError('shop_not_found');
    return s;
  },
  busy: (slug, from, to) => rpc('busy_slots', { p_slug: slug, p_from: from, p_to: to }),
  createOrder: async (order) => (await invoke<{ order: CreatedOrder }>({ action: 'create_order', order })).order,
  cancelOrder: async (token) => (await invoke<{ order: OrderView }>({ action: 'cancel_order', token })).order,
  orders: (tokens) => (tokens.length ? rpc('orders_by_tokens', { p_tokens: tokens }) : Promise.resolve([])),
  order: (token) => rpc('order_by_token', { p_token: token }),
  ask: (slug, question, tokens) => invoke({ action: 'assistant', slug, question, tokens }),
};

// ───────────────────────── sample (on this device only) ─────────────────────────
type SampleOrder = OrderView & { shopSlug: string; idempotencyKey: string };

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function sampleApi(tenant: BundledTenant): ShopApi {
  const key = `sample-orders:${tenant.slug}`;
  const shop: PublicShop = { id: 'sample-' + tenant.slug, slug: tenant.slug, mode: 'sample', settings: tenant.settings, bouquets: tenant.bouquets };
  const load = (): SampleOrder[] => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
  };
  const save = (list: SampleOrder[]) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* ignore */ } };
  const view = (o: SampleOrder): SampleOrder => ({ ...o, canCancel: canCancel(shop.settings, o, new Date()) });
  const busy = (from: string, to: string) => {
    const out: Record<string, number> = {};
    for (const o of load()) {
      if (!['new', 'confirmed', 'delivering'].includes(o.status)) continue;
      const d = localDay(new Date(o.slotStart), shop.settings.timezone);
      if (d >= from && d <= to) out[o.slotStart] = (out[o.slotStart] ?? 0) + 1;
    }
    return out;
  };
  const api: ShopApi = {
    shop: async () => shop,
    busy: async (_slug, from, to) => busy(from, to),
    async createOrder(input) {
      const parsed = orderInputSchema.safeParse(input);
      if (!parsed.success) throw new ApiError('invalid_input', undefined, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      const v = parsed.data;
      const list = load();
      const dup = list.find((o) => o.idempotencyKey === v.idempotencyKey);
      if (dup) return { ...view(dup), duplicate: true };
      const problem = validateSlot(shop.settings, v.slotStart, new Date());
      if (problem) throw new ApiError('too_soon', problem);
      const start = new Date(v.slotStart).toISOString();
      const day = localDay(new Date(start), shop.settings.timezone);
      if ((busy(day, day)[start] ?? 0) >= shop.settings.delivery.slotCapacity) throw new ApiError('slot_busy');
      const b = shop.bouquets.find((x) => x.id === v.bouquetId);
      if (!b) throw new ApiError('bouquet_not_found');
      if (!b.inStock || (b.stock !== null && b.stock < v.quantity)) throw new ApiError('out_of_stock');
      const o: SampleOrder = {
        id: crypto.randomUUID(), number: list.length + 1, token: randomToken(), status: 'new',
        createdAt: new Date().toISOString(), slotStart: start, bouquetId: b.id, bouquetName: b.name, bouquetPhoto: b.photo,
        quantity: v.quantity, price: priceOrder(shop.settings, b.price, v.quantity), name: v.name, phone: v.phone,
        contactChannel: v.contactChannel, contactHandle: v.contactHandle, address: v.address, comment: v.comment,
        canCancel: true, cancelDeadline: cancelDeadline(shop.settings, start).toISOString(), shopSlug: shop.slug, idempotencyKey: v.idempotencyKey,
      };
      save([...list, o]);
      return { ...view(o), duplicate: false };
    },
    async cancelOrder(token) {
      const list = load();
      const o = list.find((x) => x.token === token);
      if (!o) throw new ApiError('order_not_found');
      if (!canCancel(shop.settings, o, new Date())) throw new ApiError('cancel_too_late');
      o.status = 'cancelled_by_client';
      save(list);
      return view(o);
    },
    orders: async (tokens) => load().filter((o) => tokens.includes(o.token)).map(view).sort((a, b) => b.slotStart.localeCompare(a.slotStart)),
    order: async (token) => { const o = load().find((x) => x.token === token); return o ? view(o) : null; },
    async ask(_slug, question, tokens) {
      const db: Db = {
        rpc: async (fn, args = {}) => {
          if (fn === 'shop_public') return { data: shop, error: null };
          if (fn === 'busy_slots') return { data: busy(String(args.p_from), String(args.p_to)), error: null };
          if (fn === 'orders_by_tokens') return { data: await api.orders(args.p_tokens as string[]), error: null };
          return { data: null, error: { message: 'forbidden' } };
        },
      };
      return answerQuestion({ db } as never, shop.slug, question, tokens);
    },
  };
  return api;
}

export function dayRange(tz: string, days: number) {
  const now = new Date();
  return { from: localDay(now, tz), to: localDay(addDays(now, days), tz) };
}
