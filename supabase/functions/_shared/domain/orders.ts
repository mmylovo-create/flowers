// Order input, prices with quantity discounts, cancellation rules.
import { z } from 'zod';
import { normalizePhone, type ShopSettings } from './config.ts';

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

export const orderInputSchema = z
  .object({
    shopSlug: z.string().min(2),
    bouquetId: z.string().min(2),
    quantity: z.number().int().min(1, 'Минимум 1').max(99, 'Не больше 99'),
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
  })
  .transform((v) => ({
    ...v,
    phone: normalizePhone(v.phone)!,
    contactHandle: normalizeContact(v.contactChannel, v.contactHandle)!,
  }));
export type OrderInput = z.input<typeof orderInputSchema>;
export type ValidOrder = z.output<typeof orderInputSchema>;

export interface PriceBreakdown {
  unitPrice: number;
  quantity: number;
  subtotal: number;
  discountPercent: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

export function discountFor(s: Pick<ShopSettings, 'advance'>, qty: number): number {
  return s.advance.discounts
    .filter((t) => qty >= t.minQty)
    .reduce((best, t) => Math.max(best, t.percent), 0);
}

/** Same arithmetic as public.price_order() in SQL. Rubles, rounded down to whole rubles. */
export function priceOrder(s: Pick<ShopSettings, 'advance' | 'delivery'>, unitPrice: number, qty: number): PriceBreakdown {
  const subtotal = unitPrice * qty;
  const discountPercent = discountFor(s, qty);
  const discount = Math.floor((subtotal * discountPercent) / 100);
  const afterDiscount = subtotal - discount;
  const free = s.delivery.freeFrom !== null && afterDiscount >= s.delivery.freeFrom;
  const deliveryFee = free ? 0 : s.delivery.fee;
  return { unitPrice, quantity: qty, subtotal, discountPercent, discount, deliveryFee, total: afterDiscount + deliveryFee };
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
  bouquetId: string;
  bouquetName: string;
  bouquetPhoto: string;
  quantity: number;
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

export function cancelDeadline(s: Pick<ShopSettings, 'cancel'>, slotStartIso: string): Date {
  return new Date(new Date(slotStartIso).getTime() - s.cancel.untilMinutesBefore * 60_000);
}

export function canCancel(s: Pick<ShopSettings, 'cancel'>, o: { status: OrderStatus; slotStart: string }, now: Date): boolean {
  return (o.status === 'new' || o.status === 'confirmed') && now < cancelDeadline(s, o.slotStart);
}
