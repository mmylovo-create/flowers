// Order input, prices with quantity discounts, cancellation rules.
import { z } from 'zod';
import { normalizePhone, type ProductKind, type ShopSettings } from './config.ts';

export const CONTACT_CHANNELS = ['telegram', 'vk'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function normalizeContact(channel: ContactChannel, raw: string): string | null {
  let v = raw.trim();
  if (channel === 'telegram') {
    v = v.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
    return /^[A-Za-z0-9_]{5,32}$/.test(v) ? '@' + v : null;
  }
  v = v.replace(/^https?:\/\/(m\.)?vk\.(com|ru)\//i, '').replace(/^@/, '');
  return /^[A-Za-z0-9_.]{2,50}$/.test(v) ? v : null;
}

export const MAX_CARD_TEXT = 300;

export const orderItemInputSchema = z.object({
  productId: z.string().min(2),
  quantity: z.number().int().min(1, 'Минимум 1').max(99, 'Не больше 99'),
  /** text written on a postcard */
  note: z.string().trim().max(MAX_CARD_TEXT, `Текст открытки — до ${MAX_CARD_TEXT} символов`).default(''),
});
export type OrderItemInput = z.input<typeof orderItemInputSchema>;

export const orderInputSchema = z
  .object({
    shopSlug: z.string().min(2),
    items: z.array(orderItemInputSchema).min(1, 'Корзина пуста — добавьте букет').max(20, 'Не больше 20 позиций'),
    slotStart: z.string().datetime({ offset: true, message: 'Выберите время доставки' }),
    name: z.string().trim().min(2, 'Укажите имя').max(60, 'Слишком длинное имя'),
    phone: z.string().trim().refine((v) => normalizePhone(v) !== null, 'Телефон: +7 и 10 цифр'),
    contactChannel: z.enum(CONTACT_CHANNELS, { message: 'Выберите VK или Telegram' }),
    contactHandle: z.string().trim().min(1, 'Укажите ник для связи'),
    address: z.string().trim().min(5, 'Укажите адрес доставки').max(200),
    comment: z.string().trim().max(500).default(''),
    deliveryConfirmed: z.literal(true, { message: 'Подтвердите доставку' }),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
    if (normalizeContact(v.contactChannel, v.contactHandle) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactHandle'],
        message: v.contactChannel === 'telegram' ? 'Ник Telegram: @username' : 'VK: короткое имя или ссылка на страницу',
      });
    }
    const ids = v.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Одна позиция указана дважды' });
  })
  .transform((v) => ({
    ...v,
    phone: normalizePhone(v.phone)!,
    contactHandle: normalizeContact(v.contactChannel, v.contactHandle)!,
  }));
export type OrderInput = z.input<typeof orderInputSchema>;
export type ValidOrder = z.output<typeof orderInputSchema>;

export interface PriceLine { price: number; quantity: number; kind: ProductKind }

export interface PriceBreakdown {
  /** bouquets before discount */
  bouquetsSubtotal: number;
  /** number of bouquets — the quantity discount counts these */
  bouquetCount: number;
  cardsSubtotal: number;
  subtotal: number;
  discountPercent: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

export function discountFor(s: Pick<ShopSettings, 'advance'>, bouquetCount: number): number {
  return s.advance.discounts
    .filter((t) => bouquetCount >= t.minQty)
    .reduce((best, t) => Math.max(best, t.percent), 0);
}

/**
 * Same arithmetic as public.create_order() in SQL. Whole rubles.
 * The quantity discount applies to bouquets only; postcards are always full price.
 */
export function priceOrder(s: Pick<ShopSettings, 'advance' | 'delivery'>, lines: PriceLine[]): PriceBreakdown {
  const bouquets = lines.filter((l) => l.kind === 'bouquet');
  const bouquetsSubtotal = bouquets.reduce((a, l) => a + l.price * l.quantity, 0);
  const bouquetCount = bouquets.reduce((a, l) => a + l.quantity, 0);
  const cardsSubtotal = lines.filter((l) => l.kind === 'card').reduce((a, l) => a + l.price * l.quantity, 0);
  const discountPercent = discountFor(s, bouquetCount);
  const discount = Math.floor((bouquetsSubtotal * discountPercent) / 100);
  const subtotal = bouquetsSubtotal + cardsSubtotal;
  const afterDiscount = subtotal - discount;
  const free = s.delivery.freeFrom !== null && afterDiscount >= s.delivery.freeFrom;
  const deliveryFee = lines.length === 0 || free ? 0 : s.delivery.fee;
  return { bouquetsSubtotal, bouquetCount, cardsSubtotal, subtotal, discountPercent, discount, deliveryFee, total: afterDiscount + deliveryFee };
}

export function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

export type OrderStatus = 'new' | 'confirmed' | 'delivering' | 'done' | 'cancelled_by_client' | 'cancelled_by_shop';
export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'confirmed', 'delivering'];
export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  delivering: 'В пути',
  done: 'Доставлен',
  cancelled_by_client: 'Отменён вами',
  cancelled_by_shop: 'Отменён магазином',
};

export interface OrderView {
  id: string;
  number: number;
  token: string;
  status: OrderStatus;
  createdAt: string;
  slotStart: string;
  items: OrderItemView[];
  /** photo of the first bouquet, for lists */
  bouquetPhoto: string;
  price: PriceBreakdown;
  name: string;
  phone: string;
  contactChannel: ContactChannel;
  contactHandle: string;
  address: string;
  comment: string;
  canCancel: boolean;
  cancelDeadline: string;
  shopSlug?: string;
}

export interface OrderItemView {
  productId: string;
  kind: ProductKind;
  name: string;
  photo: string;
  quantity: number;
  unitPrice: number;
  note: string;
}

/** «Пионовое облако × 3, Открытка «Люблю»» */
export function orderSummary(o: Pick<OrderView, 'items'>): string {
  return o.items.map((i) => i.name + (i.quantity > 1 ? ` × ${i.quantity}` : '')).join(', ');
}

export function cancelDeadline(s: Pick<ShopSettings, 'cancel'>, slotStartIso: string): Date {
  return new Date(new Date(slotStartIso).getTime() - s.cancel.untilMinutesBefore * 60_000);
}

export function canCancel(s: Pick<ShopSettings, 'cancel'>, o: { status: OrderStatus; slotStart: string }, now: Date): boolean {
  return (o.status === 'new' || o.status === 'confirmed') && now < cancelDeadline(s, o.slotStart);
}
