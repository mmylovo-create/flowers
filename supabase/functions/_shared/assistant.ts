// The in-app helper. It answers only from live shop data read through the database
// functions (public shop data + the caller's own orders by their secret tokens).
// With ANTHROPIC_API_KEY set it phrases answers with an LLM over the same facts;
// otherwise it answers with built-in rules.
import { addDays } from 'date-fns';
import {
  daySlots, deliveryDays, formatPhone, formatRub, formatSlot, hoursSummary, isOpenNow, localDay,
  STATUS_LABELS, type OrderView, type PublicShop,
} from './domain/index.ts';
import { call, type ServerDeps } from './server.ts';

export interface AssistantAnswer { answer: string; facts: string[] }

function norm(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е');
}

export async function buildFacts(deps: Pick<ServerDeps, 'db'>, slug: string, tokens: string[], now = new Date()) {
  const shop = await call<PublicShop | null>(deps.db, 'shop_public', { p_slug: slug });
  if (!shop) return null;
  const s = shop.settings;
  const from = localDay(now, s.timezone);
  const to = localDay(addDays(now, 7), s.timezone);
  const busy = await call<Record<string, number>>(deps.db, 'busy_slots', { p_slug: slug, p_from: from, p_to: to });
  let nearest: string | null = null;
  for (const d of deliveryDays(s, now).slice(0, 8)) {
    if (!d.isOpen) continue;
    const free = daySlots(s, d.date, now, busy).find((x) => x.state === 'free');
    if (free) { nearest = formatSlot(free.start, s.timezone, s.delivery.slotMinutes); break; }
  }
  const orders = tokens.length ? await call<OrderView[]>(deps.db, 'orders_by_tokens', { p_tokens: tokens }) : [];
  return { shop, nearest, orders: orders.filter((o) => (o as OrderView & { shopSlug?: string }).shopSlug === slug), open: isOpenNow(s, now) };
}

type Facts = NonNullable<Awaited<ReturnType<typeof buildFacts>>>;

export function factLines(f: Facts): Record<string, string> {
  const s = f.shop.settings;
  const inStock = f.shop.bouquets.filter((b) => b.inStock);
  const out: Record<string, string> = {
    hours: `Время работы: ${hoursSummary(s)}. Сейчас ${f.open ? 'открыто' : 'закрыто'}.`,
    address: `Адрес: ${s.address}.`,
    contacts: `Телефон: ${formatPhone(s.phone)}${s.telegram ? `, Telegram ${s.telegram.startsWith('@') ? s.telegram : '@' + s.telegram}` : ''}${s.vk ? `, VK vk.com/${s.vk}` : ''}.`,
    delivery: `Доставка по городу от 1 часа${s.delivery.zone ? ` (${s.delivery.zone})` : ''}: ${s.delivery.fee ? formatRub(s.delivery.fee) : 'бесплатно'}${s.delivery.freeFrom !== null ? `, бесплатно от ${formatRub(s.delivery.freeFrom)}` : ''}. ${f.nearest ? `Ближайшее свободное время: ${f.nearest}.` : 'Свободного времени на ближайшую неделю нет — позвоните нам.'}`,
    stock: inStock.length
      ? `В наличии: ${inStock.map((b) => `${b.name} — ${formatRub(b.price)}`).join('; ')}.`
      : 'Сейчас нет букетов в наличии.',
    outOfStock: f.shop.bouquets.filter((b) => !b.inStock).map((b) => b.name).join(', '),
    discounts: s.advance.discounts.length
      ? `Скидки при заказе нескольких букетов: ${s.advance.discounts.map((d) => `от ${d.minQty} шт. — ${d.percent}%`).join(', ')}. Заказать можно заранее, до ${s.delivery.maxAdvanceDays} дней вперёд.`
      : `Заказать можно заранее, до ${s.delivery.maxAdvanceDays} дней вперёд.`,
    cancel: s.cancel.rules || `Отменить заказ можно не позже чем за ${Math.round(s.cancel.untilMinutesBefore / 60)} ч до доставки.`,
    orders: f.orders.length
      ? f.orders.map((o) => `Заказ №${o.number} (${o.bouquetName} × ${o.quantity}) на ${formatSlot(o.slotStart, s.timezone, s.delivery.slotMinutes)} — ${STATUS_LABELS[o.status]}`).join('; ') + '.'
      : 'На этом устройстве нет заказов в этом магазине.',
  };
  return out;
}

const INTENTS: { key: string; re: RegExp }[] = [
  { key: 'orders', re: /(мой|мои|моего|статус|где).{0,20}заказ|заказ.{0,10}(статус|где|когда привез)/ },
  { key: 'cancel', re: /отмен/ },
  { key: 'discounts', re: /скидк|заранее|оптом|много букет|несколько букет|акци/ },
  { key: 'delivery', re: /доставк|привез|курьер|ближайш|когда (можно|сможете)|свободн|время доставки/ },
  { key: 'hours', re: /работаете|график|часы|открыт|закрыт|время работы|выходн/ },
  { key: 'address', re: /адрес|где (вы|находит)|самовывоз|как добрат/ },
  { key: 'contacts', re: /телефон|позвон|связат|телеграм|telegram|(^|[^а-яa-z])(вк|vk)([^а-яa-z]|$)|написать/ },
  { key: 'stock', re: /налич|есть ли|какие букет|что есть|ассортимент|каталог/ },
];

export function ruleAnswer(f: Facts, question: string): AssistantAnswer {
  const q = norm(question);
  const lines = factLines(f);
  const facts: string[] = [];
  // a bouquet mentioned by name → its price and availability
  for (const b of f.shop.bouquets) {
    const words = norm(b.name).split(/\s+/).filter((w) => w.length > 3).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    if (words.some((w) => q.includes(w))) {
      facts.push(`«${b.name}» — ${formatRub(b.price)}, ${b.inStock ? 'есть в наличии' : 'сейчас нет в наличии'}. ${b.description}`.trim());
    }
  }
  for (const it of INTENTS) if (it.re.test(q)) facts.push(lines[it.key]);
  if (!facts.length && /цен|стоит|стоимост|сколько/.test(q)) facts.push(lines.stock);
  if (!facts.length) {
    facts.push(lines.stock, lines.delivery);
    return { answer: `Вот что могу подсказать прямо сейчас:\n${facts.join('\n')}\nСпросите про доставку, скидки, время работы или ваш заказ.`, facts };
  }
  return { answer: [...new Set(facts)].join('\n'), facts };
}

export async function answerQuestion(deps: ServerDeps, slug: string, question: string, tokens: string[]): Promise<AssistantAnswer> {
  const f = await buildFacts(deps, slug, tokens);
  if (!f) return { answer: 'Магазин не найден.', facts: [] };
  const base = ruleAnswer(f, question);
  if (deps.assistantLlm) {
    const all = factLines(f);
    const system = [
      `Ты помощник цветочного магазина «${f.shop.settings.name}». Отвечай коротко и дружелюбно, по-русски.`,
      'Используй только факты ниже. Если ответа нет в фактах — предложи позвонить или написать.',
      'Не выдумывай цены, время и наличие. Не раскрывай чужие данные.',
      'Факты:',
      ...Object.values(all),
      ...f.shop.bouquets.map((b) => `${b.name}: ${formatRub(b.price)}, ${b.inStock ? 'в наличии' : 'нет в наличии'}. ${b.description}`),
    ].join('\n');
    try {
      const llm = await deps.assistantLlm(system, question);
      if (llm) return { answer: llm, facts: base.facts };
    } catch (e) {
      deps.log?.('llm failed', e);
    }
  }
  return base;
}

/** Optional LLM phrasing through the Anthropic Messages API. */
export function anthropicLlm(apiKey: string, model: string, f: typeof fetch = fetch) {
  return async (system: string, question: string): Promise<string | null> => {
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: 'user', content: question }] }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { content?: { type: string; text?: string }[] };
    return j.content?.find((c) => c.type === 'text')?.text?.trim() || null;
  };
}
