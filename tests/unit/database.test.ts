// Runs the production SQL migrations on real Postgres (PGlite) and exercises the
// ordering rules, permissions, server functions, the Telegram bot and the assistant.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LocalDb, type Claims } from '../../dev/pg.ts';
import { daySlots, deliveryDays, tenantFileSchema, type OrderView } from '@domain';
import { createApiHandler, TelegramClient, type Db, type ServerDeps } from '@server/server.ts';
import { createTelegramHandler } from '@server/telegram.ts';

const tenant = tenantFileSchema.parse(JSON.parse(readFileSync('tenants/demo/shop.json', 'utf8')));
const S = tenant.settings;
const svc: Claims = { role: 'service_role' };
let db: LocalDb;
let shopId: string;
let ownerId: string;
const sent: { method: string; payload: Record<string, unknown> }[] = [];

function serviceDb(): Db {
  return {
    rpc: (fn, args = {}) => db.rpc(fn, args, svc).then(
      (data) => ({ data, error: null }),
      (e: Error & { code?: string; detail?: string }) => ({ data: null, error: { message: e.message, code: e.code, details: e.detail } }),
    ),
  };
}
const fakeFetch: typeof fetch = async (url, init) => {
  const method = String(url).split('/').pop()!;
  const payload = init?.body ? JSON.parse(String(init.body)) : {};
  sent.push({ method, payload });
  if (String(url).includes('/file/')) return new Response(new Uint8Array([1, 2, 3]));
  if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'photos/x.jpg' } });
  return Response.json({ ok: true, result: { message_id: sent.length } });
};
const deps = (): ServerDeps => ({
  db: serviceDb(),
  telegram: new TelegramClient('T', 'https://tg.test', fakeFetch),
  siteUrl: 'https://shop.test',
  botUsername: 'bot',
  webhookSecret: 'secret',
  uploadMedia: async (sid, path) => `https://cdn.test/${sid}/${path}`,
});

// A free slot `n` positions into tomorrow (shop time)
function slot(n = 0, dayOffset = 1): string {
  const now = new Date();
  const day = deliveryDays(S, now).filter((d) => d.isOpen)[dayOffset].date;
  return daySlots(S, day, now, {}).filter((x) => x.state === 'free')[n].start;
}
function order(over: Record<string, unknown> = {}) {
  return {
    shopSlug: 'demo', items: [{ productId: 'morning-garden', quantity: 1 }], slotStart: slot(), name: 'Анна',
    phone: '+7 999 111-22-33', contactChannel: 'telegram', contactHandle: '@anna_test', address: 'Москва, ул. Пушкина, 1',
    comment: '', deliveryConfirmed: true, idempotencyKey: crypto.randomUUID(), ...over,
  };
}
async function api(body: unknown) {
  const r = await createApiHandler(deps())(new Request('https://x/api', { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as { order?: OrderView & { duplicate: boolean }; error?: string; message?: string; answer?: string } };
}
async function tg(update: unknown) {
  return createTelegramHandler(deps())(new Request('https://x/tg', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'secret' }, body: JSON.stringify(update),
  }));
}

beforeAll(async () => {
  db = await LocalDb.create();
  const r = (await db.rpc('seed_shop', { p: { ...tenant, mode: 'live' } }, svc)) as { id: string };
  shopId = r.id;
  const u = await db.pg.query<{ id: string }>(`insert into auth.users (email) values ('owner@test') returning id`);
  ownerId = u.rows[0].id;
  await db.rpc('add_owner', { p_shop: shopId, p_user: ownerId }, svc);
});

describe('creating orders', () => {
  it('creates an order with server-side price and notification', async () => {
    const { status, body } = await api({ action: 'create_order', order: order({ items: [{ productId: 'morning-garden', quantity: 3 }] }) });
    expect(status).toBe(200);
    expect(body.order).toMatchObject({ status: 'new', duplicate: false, phone: '+79991112233' });
    expect(body.order!.items).toEqual([{ productId: 'morning-garden', kind: 'bouquet', name: 'Утренний сад', photo: 'photos/morning-garden.jpg', quantity: 3, unitPrice: 4200, note: '' }]);
    expect(body.order!.price).toMatchObject({ bouquetsSubtotal: 12600, bouquetCount: 3, subtotal: 12600, discountPercent: 5, deliveryFee: 0, total: 11970 });
    expect(body.order!.token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('an order with several bouquets and a postcard: one delivery, discount on bouquets only, card text kept', async () => {
    const { status, body } = await api({ action: 'create_order', order: order({
      slotStart: slot(5),
      items: [
        { productId: 'white-tulips', quantity: 2 },
        { productId: 'morning-garden', quantity: 1 },
        { productId: 'card-birthday', quantity: 1, note: 'С днём рождения, мама!' },
      ],
    }) });
    expect(status).toBe(200);
    const o = body.order!;
    expect(o.items.map((i) => [i.productId, i.kind, i.quantity, i.note])).toEqual([
      ['white-tulips', 'bouquet', 2, ''], ['morning-garden', 'bouquet', 1, ''], ['card-birthday', 'card', 1, 'С днём рождения, мама!'],
    ]);
    // 2×3200 + 4200 = 10600 bouquets, −5% = 530; card 250 at full price
    expect(o.price).toMatchObject({ bouquetCount: 3, bouquetsSubtotal: 10600, cardsSubtotal: 250, discount: 530, deliveryFee: 0, total: 10320 });
    expect(o.bouquetPhoto).toBe('photos/white-tulips.jpg');
  });

  it('balloons are delivered on their own (with a postcard), at full price', async () => {
    const { status, body } = await api({ action: 'create_order', order: order({
      slotStart: slot(7),
      items: [{ productId: 'balloon-heart', quantity: 2 }, { productId: 'card-love', quantity: 1, note: 'Люблю' }],
    }) });
    expect(status).toBe(200);
    expect(body.order!.price).toMatchObject({ bouquetCount: 0, balloonsSubtotal: 1380, cardsSubtotal: 250, discount: 0, deliveryFee: 400, total: 2030 });
    expect(body.order!.bouquetPhoto).toBe('photos/balloon-heart.jpg');
    const pub = (await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { bouquets: { id: string; stock: number }[] };
    expect(pub.bouquets.find((b) => b.id === 'balloon-heart')!.stock).toBe(13);
  });

  it('a postcard alone is not delivered; the same product twice is rejected', async () => {
    const r = await api({ action: 'create_order', order: order({ slotStart: slot(6), items: [{ productId: 'card-love', quantity: 1 }] }) });
    expect(r.body.error).toBe('no_bouquet');
    const d = await api({ action: 'create_order', order: order({ slotStart: slot(6), items: [{ productId: 'pion-cloud', quantity: 1 }, { productId: 'pion-cloud', quantity: 1 }] }) });
    expect(d.status).toBe(422);
  });

  it('a repeated confirmation (same key) returns the same order, no copy', async () => {
    const o = order({ slotStart: slot(1) });
    const [a, b] = await Promise.all([api({ action: 'create_order', order: o }), api({ action: 'create_order', order: o })]);
    expect(a.body.order!.id).toBe(b.body.order!.id);
    expect([a.body.order!.duplicate, b.body.order!.duplicate].sort()).toEqual([false, true]);
    const n = await db.pg.query<{ c: number }>(`select count(*)::int c from orders where idempotency_key = $1`, [o.idempotencyKey]);
    expect(n.rows[0].c).toBe(1);
  });

  it('two people booking the same time at once: exactly one succeeds', async () => {
    const start = slot(2);
    const results = await Promise.all([1, 2, 3].map((i) =>
      api({ action: 'create_order', order: order({ slotStart: start, name: 'Клиент ' + i }) })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const lost = results.filter((r) => r.status !== 200);
    expect(lost.map((r) => r.body.error)).toEqual(['slot_busy', 'slot_busy']);
    expect(lost[0].body.message).toMatch(/занял/);
  });

  it('the unique index rejects a second active order in the same seat even without the function', async () => {
    const o = (await db.pg.query<Record<string, unknown>>(`select * from orders where status = 'new' limit 1`)).rows[0];
    await expect(db.pg.query(
      `insert into orders (shop_id, number, token, idempotency_key, slot_start, slot_seq,
        bouquet_count, bouquets_subtotal, subtotal, total, name, phone, contact_channel, contact_handle, address)
       values ($1, 9999, 'x', gen_random_uuid(), $2, 1, 1, 1, 1, 1, 'aa', '+79990000000', 'vk', 'aa', 'aaaaa')`,
      [o.shop_id, o.slot_start])).rejects.toThrow(/orders_one_per_slot_seat/);
  });

  it('busy slots are reported to the browser', async () => {
    const day = new Date(slot(2)).toISOString();
    const busy = (await db.rpc('busy_slots', { p_slug: 'demo', p_from: new Date().toISOString().slice(0, 10), p_to: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10) }, { role: 'anon' })) as Record<string, number>;
    expect(busy[day]).toBe(1);
  });

  it('rejects too-early, closed-hours and invalid orders', async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    soon.setUTCMinutes(0, 0, 0);
    expect((await api({ action: 'create_order', order: order({ slotStart: soon.toISOString() }) })).body.error).toMatch(/too_soon|closed|bad_slot/);
    const late = new Date(slot(0)); late.setUTCMinutes(30);
    expect((await api({ action: 'create_order', order: order({ slotStart: late.toISOString() }) })).body.error).toBe('bad_slot');
    expect((await api({ action: 'create_order', order: order({ deliveryConfirmed: false }) })).status).toBe(422);
    expect((await api({ action: 'create_order', order: order({ items: [{ productId: 'field-mix', quantity: 1 }] }) })).body.error).toBe('out_of_stock');
  });

  it('browsers cannot call create_order directly', async () => {
    await expect(db.rpc('create_order', { p: order() }, { role: 'anon' })).rejects.toThrow(/permission denied/);
  });

  it('stock is reserved and returned on cancel', async () => {
    const before = ((await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { bouquets: { id: string; stock: number }[] })
      .bouquets.find((b) => b.id === 'pion-cloud')!.stock;
    const { body } = await api({ action: 'create_order', order: order({ items: [{ productId: 'pion-cloud', quantity: 2 }, { productId: 'card-love', quantity: 1, note: 'Люблю' }], slotStart: slot(3) }) });
    const mid = ((await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { bouquets: { id: string; stock: number }[] })
      .bouquets.find((b) => b.id === 'pion-cloud')!.stock;
    expect(mid).toBe(before - 2);
    const c = await api({ action: 'cancel_order', token: body.order!.token });
    expect(c.body.order!.status).toBe('cancelled_by_client');
    const after = ((await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { bouquets: { id: string; stock: number }[] })
      .bouquets.find((b) => b.id === 'pion-cloud')!.stock;
    expect(after).toBe(before);
    // the freed time can be booked again
    expect((await api({ action: 'create_order', order: order({ slotStart: slot(3) }) })).status).toBe(200);
  });
});

describe('owner rights', () => {
  const owner = (): Claims => ({ role: 'authenticated', sub: ownerId });
  it('owner sees orders, a stranger does not', async () => {
    const list = (await db.rpc('owner_orders', { p_shop: shopId }, owner())) as OrderView[];
    expect(list.length).toBeGreaterThan(2);
    await expect(db.rpc('owner_orders', { p_shop: shopId }, { role: 'authenticated', sub: crypto.randomUUID() })).rejects.toThrow('forbidden');
    await expect(db.rpc('owner_orders', { p_shop: shopId }, { role: 'anon' })).rejects.toThrow(/permission denied/);
  });

  it('owner changes stock, price, hours and they show on the site', async () => {
    await db.rpc('owner_set_stock', { p_shop: shopId, p_bouquet: 'field-mix', p_in_stock: true, p_stock: null }, owner());
    const settings = { ...S, phone: '+79990001122', hours: { ...S.hours, sun: null } };
    await db.rpc('owner_update_settings', { p_shop: shopId, p_settings: settings }, owner());
    const pub = (await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { settings: typeof S; bouquets: { id: string; inStock: boolean }[] };
    expect(pub.bouquets.find((b) => b.id === 'field-mix')!.inStock).toBe(true);
    expect(pub.settings.phone).toBe('+79990001122');
    expect(pub.settings.hours.sun).toBeNull();
    await expect(db.rpc('owner_update_settings', { p_shop: shopId, p_settings: { ...S, phone: '123' } }, owner())).rejects.toThrow('bad_settings');
  });
});

describe('Telegram bot', () => {
  const CHAT = 555;
  it('links a chat with a code from the cabinet and receives new orders', async () => {
    const { code } = (await db.rpc('owner_telegram_code', { p_shop: shopId }, { role: 'authenticated', sub: ownerId })) as { code: string };
    await tg({ update_id: 1, message: { message_id: 1, chat: { id: CHAT, type: 'private' }, text: `/start ${code}` } });
    expect(String(sent.at(-1)!.payload.text)).toMatch(/подключён к магазину «Флёр»/);
    sent.length = 0;
    const { body } = await api({ action: 'create_order', order: order({ slotStart: slot(4) }) });
    const msg = sent.find((m) => m.method === 'sendMessage' && m.payload.chat_id === CHAT)!;
    expect(String(msg.payload.text)).toContain(`Новый заказ №${body.order!.number}`);
    expect(String(msg.payload.text)).toContain('Telegram @anna_test');
    // owner taps «Подтвердить»
    await tg({ update_id: 2, callback_query: { id: 'q', from: { id: CHAT }, message: { message_id: 9, chat: { id: CHAT, type: 'private' } }, data: `o:${body.order!.id}:c` } });
    const o = (await db.rpc('order_by_token', { p_token: body.order!.token }, { role: 'anon' })) as OrderView;
    expect(o.status).toBe('confirmed');
  });

  it('changes price and stock, adds a bouquet with a photo', async () => {
    await tg({ update_id: 3, message: { message_id: 2, chat: { id: CHAT, type: 'private' }, text: '/price white-tulips 3500' } });
    await tg({ update_id: 4, message: { message_id: 3, chat: { id: CHAT, type: 'private' }, text: '/stock peach-box off' } });
    await tg({ update_id: 5, message: { message_id: 4, chat: { id: CHAT, type: 'private' }, caption: 'Осенний букет; 3900; Хризантемы и ягоды', photo: [{ file_id: 'f', width: 800, height: 800 }] } });
    const pub = (await db.rpc('shop_public', { p_slug: 'demo' }, { role: 'anon' })) as { bouquets: { id: string; name: string; price: number; inStock: boolean; photo: string }[] };
    expect(pub.bouquets.find((b) => b.id === 'white-tulips')!.price).toBe(3500);
    expect(pub.bouquets.find((b) => b.id === 'peach-box')!.inStock).toBe(false);
    const added = pub.bouquets.find((b) => b.name === 'Осенний букет')!;
    expect(added).toMatchObject({ price: 3900, inStock: true });
    expect(added.photo).toMatch(/^https:\/\/cdn\.test\//);
  });

  it('ignores requests without the webhook secret and unlinked chats', async () => {
    const r = await createTelegramHandler(deps())(new Request('https://x', { method: 'POST', body: '{}' }));
    expect(r.status).toBe(401);
    sent.length = 0;
    await tg({ update_id: 6, message: { message_id: 1, chat: { id: 999, type: 'private' }, text: '/price white-tulips 1' } });
    expect(String(sent.at(-1)!.payload.text)).toMatch(/не подключён/);
  });
});

describe('assistant', () => {
  it('answers from live data', async () => {
    const r = await api({ action: 'assistant', slug: 'demo', question: 'Сколько стоят белые тюльпаны?' });
    expect(r.body.answer).toContain('Белые тюльпаны');
    expect(r.body.answer).toMatch(/3\s500 ₽/); // price changed through the bot above
    const d = await api({ action: 'assistant', slug: 'demo', question: 'Когда ближайшая доставка?' });
    expect(d.body.answer).toMatch(/Ближайшее свободное время: .+\d\d:\d\d/);
    const h = await api({ action: 'assistant', slug: 'demo', question: 'Вы работаете в воскресенье?' });
    expect(h.body.answer).toContain('Вс: выходной'); // owner changed Sunday above
  });
});
