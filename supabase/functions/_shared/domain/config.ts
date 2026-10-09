// Shop settings: one schema shared by the tenant file, the database,
// the owner cabinet, the browser app and the server functions.
import { z } from 'zod';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс',
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ');
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB');

export const dayHoursSchema = z
  .object({ open: time, close: time })
  .refine((h) => h.open < h.close, { message: 'Открытие должно быть раньше закрытия' })
  .nullable();

export const hoursSchema = z.object({
  mon: dayHoursSchema, tue: dayHoursSchema, wed: dayHoursSchema, thu: dayHoursSchema,
  fri: dayHoursSchema, sat: dayHoursSchema, sun: dayHoursSchema,
});
export type Hours = z.infer<typeof hoursSchema>;

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => normalizePhone(v))
  .refine((v): v is string => v !== null, { message: 'Телефон: +7 и 10 цифр' })
  .transform((v) => v as string);

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return '+7' + digits.slice(1);
  if (digits.length === 10 && digits[0] === '9') return '+7' + digits;
  return null;
}

export function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length !== 11) return p;
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

export const discountTierSchema = z.object({
  minQty: z.number().int().min(2).max(1000),
  percent: z.number().min(1).max(90),
});

export const PRODUCT_KINDS = ['bouquet', 'balloon', 'card', 'firework'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const KIND_LABELS: Record<ProductKind, string> = { bouquet: 'Букет', balloon: 'Шары', card: 'Открытка', firework: 'Фейерверк' };

/** Catalog subcategories, in the order they are shown. */
export const CATEGORIES: { kind: ProductKind; slug: string; title: string; short: string; hint: string }[] = [
  { kind: 'bouquet', slug: 'bouquets', title: 'Букеты', short: 'Букеты', hint: 'Собираем в день доставки из свежих цветов.' },
  { kind: 'balloon', slug: 'balloons', title: 'Воздушные шары', short: 'Шары', hint: 'Надуваем гелием перед доставкой — летают от 3 дней.' },
  { kind: 'card', slug: 'cards', title: 'Открытки', short: 'Открытки', hint: 'Подпишем от руки вашим текстом и вложим в букет.' },
  { kind: 'firework', slug: 'fireworks', title: 'Фейерверки', short: 'Фейерверки', hint: 'Салюты и фонтаны для праздника. Продаём только совершеннолетним — курьер может попросить паспорт.' },
];

/** Bouquets, balloons and fireworks can be delivered on their own; a postcard only comes with them. */
export const DELIVERABLE_KINDS: ProductKind[] = ['bouquet', 'balloon', 'firework'];

/** A catalog item: a bouquet, helium balloons, fireworks, or a postcard sold alongside them. */
export const bouquetSchema = z.object({
  kind: z.enum(PRODUCT_KINDS).default('bouquet'),
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'id: латиница, цифры и дефис'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(600).default(''),
  price: z.number().int().min(1).max(10_000_000),
  photo: z.string().min(1),
  inStock: z.boolean().default(true),
  stock: z.number().int().min(0).max(100_000).nullable().default(null), // null = без учёта количества
  sort: z.number().int().default(0),
});
export type Bouquet = z.infer<typeof bouquetSchema>;
export type Product = Bouquet;

export const reviewSchema = z.object({
  author: z.string().trim().min(1).max(60),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(800),
  date: isoDay,
});
export type Review = z.infer<typeof reviewSchema>;

/** Data the owner edits in the cabinet (stored in shops.settings). */
export const shopSettingsSchema = z.object({
  name: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(120).default(''),
  description: z.string().trim().max(800).default(''),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(5).max(160),
  mapUrl: z.string().url().or(z.literal('')).default(''),
  phone: phoneSchema,
  telegram: z.string().trim().regex(/^@?[A-Za-z0-9_]{5,32}$/, 'Telegram: @username').or(z.literal('')).default(''),
  vk: z.string().trim().regex(/^[A-Za-z0-9_.]{2,50}$/, 'VK: короткое имя страницы').or(z.literal('')).default(''),
  timezone: z.string().refine(isValidTimeZone, 'Неизвестный часовой пояс'),
  currency: z.literal('RUB').default('RUB'),
  hours: hoursSchema,
  daysOff: z.array(isoDay).max(400).default([]),
  logo: z.string().default(''),
  heroPhoto: z.string().min(1),
  delivery: z.object({
    minLeadMinutes: z.number().int().min(60).max(24 * 60).default(60),
    slotMinutes: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]).default(60),
    slotCapacity: z.number().int().min(1).max(50).default(1),
    maxAdvanceDays: z.number().int().min(1).max(365).default(30),
    fee: z.number().int().min(0).default(0),
    freeFrom: z.number().int().min(0).nullable().default(null),
    zone: z.string().trim().max(160).default(''),
  }),
  cancel: z.object({
    untilMinutesBefore: z.number().int().min(0).max(7 * 24 * 60).default(120),
    rules: z.string().trim().max(400).default(''),
  }),
  advance: z.object({
    text: z.string().trim().max(800).default(''),
    discounts: z.array(discountTierSchema).max(6).default([]),
  }),
  yandex: z.object({
    orgId: z.string().regex(/^\d*$/).default(''),
    rating: z.number().min(0).max(5).nullable().default(null),
    reviewsCount: z.number().int().min(0).nullable().default(null),
  }),
  reviews: z.array(reviewSchema).max(30).default([]),
  theme: z.object({
    accent: hex.default('#B4566F'),
    background: hex.default('#FBF5F2'),
    surface: hex.default('#FFFFFF'),
  }),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

/** The single tenant file tenants/<slug>/shop.json */
export const tenantFileSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Адрес магазина: латиница, цифры и дефис'),
  settings: shopSettingsSchema,
  bouquets: z.array(bouquetSchema).min(1).max(200)
    .refine((l) => l.some((b) => b.kind !== 'card'), 'Нужен хотя бы один букет, шары или фейерверк'),
  owner: z.object({
    email: z.string().email().or(z.literal('')).default(''),
    telegramIds: z.array(z.number().int()).default([]),
  }).default({ email: '', telegramIds: [] }),
});
export type TenantFile = z.infer<typeof tenantFileSchema>;

/** What the browser receives about a shop. */
export interface PublicShop {
  id: string;
  slug: string;
  mode: 'live' | 'sample';
  settings: ShopSettings;
  bouquets: Bouquet[];
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`);
}
