// Telegram bot for shop owners: new orders arrive here, owners change order status,
// browse the catalog by section (photo, price, description), change stock and prices,
// and add products of any section with a photo.
import { AppError, formatRub, type Bouquet, type OrderView, type ProductKind } from './domain/index.ts';
import { call, orderButtons, orderText, type ServerDeps } from './server.ts';

interface TgUser { id: number; first_name?: string }
interface TgChat { id: number; type: string }
interface TgPhoto { file_id: string; width: number; height: number; file_size?: number }
interface TgMessage { message_id: number; chat: TgChat; from?: TgUser; text?: string; caption?: string; photo?: TgPhoto[] }
interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

interface ShopRef { id: string; slug: string; name: string }
interface Session { shopId: string | null; state: { step?: string; photo?: string; bouquetId?: string; kind?: ProductKind } }

const BTN = { orders: '📦 Заказы', catalog: '🗂 Каталог', add: '➕ Добавить товар', site: '🌐 Сайт' };
// buttons of the previous menu, still understood if an old keyboard is on screen
const OLD_CATALOG = '💐 Букеты';
const OLD_ADD = '➕ Добавить букет';

const MENU = {
  keyboard: [[{ text: BTN.orders }, { text: BTN.catalog }], [{ text: BTN.add }, { text: BTN.site }]],
  resize_keyboard: true,
  is_persistent: true,
};

/** Catalog sections in the bot, in this order. */
export const BOT_SECTIONS: { kind: ProductKind; title: string; emoji: string }[] = [
  { kind: 'bouquet', title: 'Цветы', emoji: '💐' },
  { kind: 'card', title: 'Открытки', emoji: '💌' },
  { kind: 'balloon', title: 'Шары', emoji: '🎈' },
  { kind: 'firework', title: 'Фейерверки', emoji: '🎆' },
];
const section = (k: ProductKind) => BOT_SECTIONS.find((x) => x.kind === k) ?? BOT_SECTIONS[0];
const isKind = (k: string): k is ProductKind => BOT_SECTIONS.some((x) => x.kind === k);
const ADD_FORMAT = 'Название; Цена; Описание; Количество\nКоличество можно не писать — тогда без учёта остатка.\nНапример: Розовые пионы; 4500; 11 пионов в крафтовой упаковке; 5';

const HELP = [
  'Кнопки внизу:',
  `${BTN.orders} — ближайшие заказы и смена статуса`,
  `${BTN.catalog} — разделы Цветы, Открытки, Шары, Фейерверки: у каждого товара фото, цена, описание и наличие; под товаром кнопки наличия, цены и количества`,
  `${BTN.add} — выберите раздел и пришлите фото с подписью «Название; Цена; Описание; Количество»`,
  `${BTN.site} — ссылки на сайт и кабинет`,
  '/shop — выбрать магазин, если их несколько · /cancel — отменить ввод',
].join('\n');

export function createTelegramHandler(deps: ServerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    if (!deps.webhookSecret || req.headers.get('x-telegram-bot-api-secret-token') !== deps.webhookSecret) {
      return new Response('unauthorized', { status: 401 });
    }
    const update = (await req.json()) as TgUpdate;
    try {
      await handleUpdate(deps, update);
    } catch (e) {
      deps.log?.('telegram update failed', e);
    }
    // Telegram retries non-2xx responses; errors are reported to the chat instead.
    return new Response('ok');
  };
}

export async function handleUpdate(deps: ServerDeps, u: TgUpdate): Promise<void> {
  const tg = deps.telegram;
  if (!tg) return;
  if (u.callback_query) return onCallback(deps, u.callback_query);
  const m = u.message;
  if (!m || m.chat.type !== 'private') return;
  const chat = m.chat.id;
  const reply = (text: string, markup: unknown = MENU) => tg.send(chat, text, markup);

  try {
    const text = (m.text ?? '').trim();
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd?.startsWith('/') ? rawCmd.slice(1).split('@')[0].toLowerCase() : '';

    if (cmd === 'start' && args[0]) {
      const shop = await call<ShopRef>(deps.db, 'tg_link', { p_code: args[0], p_chat: chat });
      await call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: shop.id, p_state: {} });
      return void (await reply(`Готово! Этот чат подключён к магазину «${shop.name}». Сюда будут приходить новые заказы.\n\n${HELP}`));
    }

    const shops = await call<ShopRef[]>(deps.db, 'tg_shops', { p_chat: chat });
    if (shops.length === 0) {
      return void (await reply(
        'Этот чат ещё не подключён к магазину.\nОткройте кабинет на сайте → «Telegram» → «Подключить», и нажмите на полученную ссылку.',
        { remove_keyboard: true },
      ));
    }
    const session = (await call<Session | null>(deps.db, 'tg_session_get', { p_chat: chat })) ?? { shopId: null, state: {} };
    const shop = shops.find((s) => s.id === session.shopId) ?? shops[0];
    const setState = (state: Session['state']) => call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: shop.id, p_state: state });

    // photo for a new bouquet
    if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1];
      const { bytes, path } = await tg.download(best.file_id);
      const ext = (path.split('.').pop() || 'jpg').toLowerCase();
      const url = await deps.uploadMedia(shop.id, `bouquets/${Date.now()}.${ext}`, bytes, ext === 'png' ? 'image/png' : 'image/jpeg');
      const kind = session.state.kind;
      const parsed = parseBouquetText(m.caption ?? '');
      if (parsed) return void (await createBouquet(deps, chat, shop, { ...parsed, photo: url, kind }, reply, setState));
      await setState({ step: 'add_details', photo: url, kind });
      return void (await reply(`Фото получено. Теперь пришлите одной строкой:\n${ADD_FORMAT}`));
    }

    if (cmd === 'start' || cmd === 'help') return void (await reply(`Магазин: «${shop.name}»\n\n${HELP}`));
    if (cmd === 'shop') {
      return void (await reply('Выберите магазин:', {
        inline_keyboard: shops.map((s) => [{ text: (s.id === shop.id ? '● ' : '') + s.name, callback_data: `s:${s.id}` }]),
      }));
    }
    if (cmd === 'orders' || text === BTN.orders) return sendOrders(deps, chat, shop);
    if (cmd === 'catalog' || cmd === 'bouquets' || text === BTN.catalog || text === OLD_CATALOG) return sendSections(deps, chat, shop);
    if (cmd === 'site' || text === BTN.site) {
      const base = deps.siteUrl.replace(/\/$/, '');
      return void (await reply(`Сайт: ${base}/s/${shop.slug}/\nКабинет: ${base}/s/${shop.slug}/admin`));
    }
    if (cmd === 'add' || text === BTN.add || text === OLD_ADD) {
      await setState({});
      return void (await reply('В какой раздел добавить товар?', {
        inline_keyboard: chunk(BOT_SECTIONS.map((x) => ({ text: `${x.emoji} ${x.title}`, callback_data: `a:${x.kind}` })), 2),
      }));
    }
    if (cmd === 'cancel') {
      await setState({});
      return void (await reply('Отменено.'));
    }
    if (cmd === 'price') {
      const price = parsePrice(args[1] ?? '');
      if (!args[0] || price === null) return void (await reply('Формат: /price <id> <цена>, например /price pion-cloud 5200'));
      const b = await call<Bouquet>(deps.db, 'tg_set_price', { p_chat: chat, p_shop: shop.id, p_bouquet: args[0], p_price: price });
      return void (await reply(`Цена «${b.name}» теперь ${formatRub(b.price)}. На сайте уже обновилось.`));
    }
    if (cmd === 'stock') {
      const [id, v] = args;
      if (!id || !v) return void (await reply('Формат: /stock <id> on|off|<количество>'));
      const n = /^\d+$/.test(v) ? Number(v) : null;
      const inStock = n !== null ? n > 0 : /^(on|да|есть|1)$/i.test(v);
      const b = await call<Bouquet>(deps.db, 'tg_set_stock', { p_chat: chat, p_shop: shop.id, p_bouquet: id, p_in_stock: inStock, p_stock: n });
      return void (await reply(`«${b.name}»: ${stockText(b)}.`));
    }

    // replies inside a multi-step action
    if (session.state.step === 'add_details' && session.state.photo && text) {
      const parsed = parseBouquetText(text);
      if (!parsed) return void (await reply(`Не получилось разобрать. Формат:\n${ADD_FORMAT}`));
      return void (await createBouquet(deps, chat, shop, { ...parsed, photo: session.state.photo, kind: session.state.kind }, reply, setState));
    }
    if (session.state.step === 'add_photo') return void (await reply(`Жду фото товара 📷 с подписью:\n${ADD_FORMAT}`));
    if (session.state.step === 'stock' && session.state.bouquetId) {
      const n = parseStock(text);
      if (n === undefined) return void (await reply('Пришлите количество числом, например 5. 0 — нет в наличии, «-» — без учёта остатка.'));
      const b = await call<Bouquet>(deps.db, 'tg_set_stock', { p_chat: chat, p_shop: shop.id, p_bouquet: session.state.bouquetId, p_in_stock: n === null || n > 0, p_stock: n });
      await setState({});
      return void (await reply(`«${b.name}»: ${stockText(b)}.`));
    }
    if (session.state.step === 'price' && session.state.bouquetId) {
      const price = parsePrice(text);
      if (price === null) return void (await reply('Пришлите цену числом, например 4500'));
      const b = await call<Bouquet>(deps.db, 'tg_set_price', { p_chat: chat, p_shop: shop.id, p_bouquet: session.state.bouquetId, p_price: price });
      await setState({});
      return void (await reply(`Цена «${b.name}» теперь ${formatRub(b.price)}.`));
    }
    await reply(HELP);
  } catch (e) {
    await reply(e instanceof AppError ? `⚠️ ${e.message}` : '⚠️ Не получилось. Попробуйте ещё раз.');
    if (!(e instanceof AppError)) throw e;
  }
}

async function onCallback(deps: ServerDeps, q: TgCallback) {
  const tg = deps.telegram!;
  const chat = q.message?.chat.id ?? q.from.id;
  const [kind, id, arg] = (q.data ?? '').split(':');
  const answer = (text: string) => tg.api('answerCallbackQuery', { callback_query_id: q.id, text });
  try {
    if (kind === 'o') {
      const status = ({ c: 'confirmed', v: 'delivering', d: 'done', x: 'cancelled_by_shop' } as Record<string, string>)[arg];
      const o = await call<OrderView>(deps.db, 'tg_set_order_status', { p_chat: chat, p_order: id, p_status: status });
      const shops = await call<ShopRef[]>(deps.db, 'tg_shops', { p_chat: chat });
      const shop = shops.find((s) => o.shopSlug === s.slug);
      const settings = await call<{ settings: { timezone: string; delivery: { slotMinutes: number } } }>(deps.db, 'shop_public', { p_slug: o.shopSlug });
      if (q.message) {
        await tg.api('editMessageText', {
          chat_id: chat, message_id: q.message.message_id,
          text: orderText(o, shop?.name ?? '', settings.settings.timezone, settings.settings.delivery.slotMinutes),
          reply_markup: orderButtons(o),
        });
      }
      return void (await answer('Статус обновлён'));
    }
    const session = (await call<Session | null>(deps.db, 'tg_session_get', { p_chat: chat }));
    const shops = await call<ShopRef[]>(deps.db, 'tg_shops', { p_chat: chat });
    if (kind === 's') {
      const s = shops.find((x) => x.id === id);
      if (!s) return void (await answer('Нет доступа'));
      await call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: s.id, p_state: {} });
      await tg.send(chat, `Выбран магазин «${s.name}».`, MENU);
      return void (await answer('Готово'));
    }
    const shop = shops.find((s) => s.id === session?.shopId) ?? shops[0];
    if (!shop) return void (await answer('Чат не подключён'));
    if (kind === 'b') {
      const list = await call<Bouquet[]>(deps.db, 'tg_bouquets', { p_chat: chat, p_shop: shop.id });
      const cur = list.find((b) => b.id === id);
      if (!cur) return void (await answer('Товар не найден'));
      const turnOn = !cur.inStock;
      const b = await call<Bouquet>(deps.db, 'tg_set_stock', {
        p_chat: chat, p_shop: shop.id, p_bouquet: id, p_in_stock: turnOn, p_stock: turnOn && cur.stock === 0 ? null : cur.stock,
      });
      if (q.message) {
        await editProductMessage(tg, chat, q.message, b);
      }
      return void (await answer(b.inStock ? 'Теперь в наличии' : 'Скрыто: нет в наличии'));
    }
    if (kind === 'p') {
      await call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: shop.id, p_state: { step: 'price', bouquetId: id } });
      await tg.send(chat, 'Пришлите новую цену числом, например 4500');
      return void (await answer('Жду цену'));
    }
    if (kind === 'q') {
      await call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: shop.id, p_state: { step: 'stock', bouquetId: id } });
      await tg.send(chat, 'Сколько штук в наличии? Пришлите число. 0 — нет в наличии, «-» — без учёта остатка.');
      return void (await answer('Жду количество'));
    }
    if (kind === 'c' && isKind(id)) {
      await answer(section(id).title);
      return void (await sendSection(deps, chat, shop, id));
    }
    if (kind === 'a' && isKind(id)) {
      await call(deps.db, 'tg_session_set', { p_chat: chat, p_shop: shop.id, p_state: { step: 'add_photo', kind: id } });
      await tg.send(chat, `${section(id).emoji} ${section(id).title}: пришлите фото товара с подписью:\n${ADD_FORMAT}`);
      return void (await answer(section(id).title));
    }
    await answer('');
  } catch (e) {
    await answer(e instanceof AppError ? e.message : 'Ошибка');
    if (!(e instanceof AppError)) throw e;
  }
}

async function sendOrders(deps: ServerDeps, chat: number, shop: ShopRef) {
  const tg = deps.telegram!;
  const orders = (await call<OrderView[]>(deps.db, 'tg_orders', { p_chat: chat, p_shop: shop.id }))
    .filter((o) => ['new', 'confirmed', 'delivering'].includes(o.status));
  if (!orders.length) return void (await tg.send(chat, 'Активных заказов нет.'));
  const s = await call<{ settings: { timezone: string; delivery: { slotMinutes: number } } }>(deps.db, 'shop_public', { p_slug: shop.slug });
  for (const o of orders.slice(0, 15)) {
    await tg.send(chat, orderText(o, shop.name, s.settings.timezone, s.settings.delivery.slotMinutes), orderButtons(o));
  }
  if (orders.length > 15) await tg.send(chat, `Ещё ${orders.length - 15} — в кабинете на сайте.`);
}

function stockText(b: Bouquet) {
  return b.inStock ? `в наличии${b.stock !== null ? `, ${b.stock} шт.` : ''}` : 'нет в наличии';
}
/** Caption under the product photo: name, price and stock, then the description. No internal ids. */
export function productCaption(b: Bouquet) {
  const head = `${b.inStock ? '✅' : '⛔'} ${section(b.kind).emoji} ${b.name}\n${formatRub(b.price)} · ${stockText(b)}`;
  return (b.description ? `${head}\n\n${b.description}` : head).slice(0, 1000);
}
function bouquetButtons(b: Bouquet) {
  return {
    inline_keyboard: [
      [{ text: b.inStock ? 'Убрать из наличия' : 'Вернуть в наличие', callback_data: `b:${b.id}` }],
      [{ text: 'Изменить цену', callback_data: `p:${b.id}` }, { text: 'Количество', callback_data: `q:${b.id}` }],
    ],
  };
}
function photoUrl(deps: ServerDeps, shop: ShopRef, photo: string): string | null {
  if (/^https:\/\//.test(photo)) return photo;
  const base = deps.siteUrl.replace(/\/$/, '');
  if (!/^https:\/\//.test(base) || !photo) return null;
  return `${base}/t/${shop.slug}/${photo.replace(/^\.?\//, '')}`;
}
async function sendProduct(deps: ServerDeps, chat: number, shop: ShopRef, b: Bouquet) {
  const tg = deps.telegram!;
  const url = photoUrl(deps, shop, b.photo);
  if (url) {
    try {
      return void (await tg.api('sendPhoto', { chat_id: chat, photo: url, caption: productCaption(b), reply_markup: bouquetButtons(b) }));
    } catch (e) {
      deps.log?.('sendPhoto failed, sending text', e);
    }
  }
  await tg.send(chat, productCaption(b), bouquetButtons(b));
}
async function editProductMessage(tg: NonNullable<ServerDeps['telegram']>, chat: number, msg: TgMessage, b: Bouquet) {
  if (msg.photo?.length) {
    await tg.api('editMessageCaption', { chat_id: chat, message_id: msg.message_id, caption: productCaption(b), reply_markup: bouquetButtons(b) });
  } else {
    await tg.api('editMessageText', { chat_id: chat, message_id: msg.message_id, text: productCaption(b), reply_markup: bouquetButtons(b) });
  }
}
function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** «Каталог»: the four sections with how many products each has. */
async function sendSections(deps: ServerDeps, chat: number, shop: ShopRef) {
  const tg = deps.telegram!;
  const list = await call<Bouquet[]>(deps.db, 'tg_bouquets', { p_chat: chat, p_shop: shop.id });
  await tg.send(chat, 'Каталог — выберите раздел:', {
    inline_keyboard: chunk(BOT_SECTIONS.map((x) => ({
      text: `${x.emoji} ${x.title} (${list.filter((b) => b.kind === x.kind).length})`,
      callback_data: `c:${x.kind}`,
    })), 2),
  });
}

/** One section: every product as a photo card with price, description and stock buttons. */
async function sendSection(deps: ServerDeps, chat: number, shop: ShopRef, kind: ProductKind) {
  const tg = deps.telegram!;
  const list = (await call<Bouquet[]>(deps.db, 'tg_bouquets', { p_chat: chat, p_shop: shop.id })).filter((b) => b.kind === kind);
  const sec = section(kind);
  if (!list.length) {
    return void (await tg.send(chat, `${sec.emoji} ${sec.title}: пока пусто. Добавьте товар кнопкой «${BTN.add}».`, MENU));
  }
  await tg.send(chat, `${sec.emoji} ${sec.title} — ${list.length} шт.`, MENU);
  for (const b of list.slice(0, 30)) await sendProduct(deps, chat, shop, b);
  if (list.length > 30) await tg.send(chat, `Ещё ${list.length - 30} — в кабинете на сайте.`);
}

async function createBouquet(
  deps: ServerDeps, chat: number, shop: ShopRef,
  p: { name: string; price: number; description: string; stock: number | null; photo: string; kind?: ProductKind },
  reply: (t: string, m?: unknown) => Promise<unknown>, setState: (s: Session['state']) => Promise<unknown>,
) {
  const id = bouquetIdFromName(p.name);
  // the section chosen in «Добавить товар»; without it, guess from the name
  // («Открытка …» — postcard, «Шар…» — balloons, «Фейерверк…»/«Салют…» — fireworks, otherwise flowers)
  const kind: ProductKind = p.kind ?? (/^открытк/i.test(p.name) ? 'card'
    : /^(шар|шары|связка шар)/i.test(p.name) ? 'balloon'
    : /^(фейерверк|салют|батарея салют)/i.test(p.name) ? 'firework' : 'bouquet');
  const b = await call<Bouquet>(deps.db, 'tg_upsert_bouquet', {
    p_chat: chat, p_shop: shop.id,
    p: { kind, id, name: p.name, description: p.description, price: p.price, photo: p.photo, inStock: p.stock === null || p.stock > 0, stock: p.stock, sort: 100 },
  });
  await setState({});
  const sec = section(kind);
  await reply(`Готово, товар добавлен на сайт в раздел «${sec.title}».`);
  await sendProduct(deps, chat, shop, b);
}

/** «5» → 5, «0» → 0 (out of stock), «-» / «без учёта» → null (stock not tracked); anything else → undefined. */
export function parseStock(v: string): number | null | undefined {
  const t = v.trim().toLowerCase();
  if (/^(-|—|без учёта|без учета|нет учёта)$/.test(t)) return null;
  if (/^\d{1,5}( ?шт\.?)?$/.test(t)) return parseInt(t, 10);
  return undefined;
}

export function parsePrice(v: string): number | null {
  const n = Number(v.replace(/[\s₽руб.]/gi, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : null;
}

/** «Название; Цена; Описание; Количество» — description and quantity may be left out. */
export function parseBouquetText(t: string): { name: string; price: number; description: string; stock: number | null } | null {
  const parts = t.split(/[;|\n]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const price = parsePrice(parts[1]);
  if (!price || parts[0].length < 2 || parts[0].length > 80) return null;
  let rest = parts.slice(2);
  let stock: number | null = null;
  const last = rest.length ? parseStock(rest[rest.length - 1]) : undefined;
  if (rest.length && typeof last === 'number') { stock = last; rest = rest.slice(0, -1); }
  return { name: parts[0], price, description: rest.join('. ').slice(0, 600), stock };
}

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};
export function bouquetIdFromName(name: string): string {
  const base = name.toLowerCase().split('').map((c) => TR[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'buket';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
