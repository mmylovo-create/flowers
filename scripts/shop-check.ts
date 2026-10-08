// pnpm shop:check <slug> — checks tenants/<slug>/ and, when everything is right,
// marks the shop as checked. Until then the shop works only as a sample
// (orders stay on the visitor's device). Any later edit of shop.json or photos
// returns it to sample mode until the next successful check.
import sharp from 'sharp';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tenantFileSchema, zodIssues, WEEKDAYS, slotStarts, type TenantFile } from '../supabase/functions/_shared/domain/index.ts';
import { clearStamp, localMedia, readTenantRaw, tenantDir, writeStamp } from './lib/tenants.ts';

export interface CheckResult { errors: string[]; warnings: string[]; tenant: TenantFile | null }

export async function checkTenant(slug: string): Promise<CheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = tenantDir(slug);
  if (!existsSync(join(dir, 'shop.json'))) return { errors: [`Нет файла tenants/${slug}/shop.json`], warnings, tenant: null };

  let raw: unknown;
  try {
    raw = readTenantRaw(slug);
  } catch (e) {
    return { errors: [`shop.json не читается как JSON: ${(e as Error).message}`], warnings, tenant: null };
  }
  const parsed = tenantFileSchema.safeParse(raw);
  if (!parsed.success) return { errors: zodIssues(parsed.error), warnings, tenant: null };
  const t = parsed.data;
  const s = t.settings;

  if (t.slug !== slug) errors.push(`slug в файле ("${t.slug}") должен совпадать с именем папки ("${slug}")`);
  const ids = new Set<string>();
  for (const b of t.bouquets) {
    if (ids.has(b.id)) errors.push(`Повторяется id букета: ${b.id}`);
    ids.add(b.id);
  }
  if (!t.bouquets.some((b) => b.inStock)) warnings.push('Ни одного букета нет в наличии — заказать будет нечего');

  const openDays = WEEKDAYS.filter((d) => s.hours[d] !== null);
  if (!openDays.length) errors.push('В графике нет ни одного рабочего дня');
  for (const d of openDays) {
    const h = s.hours[d]!;
    // 2030-01-07 is a Monday: count slots on a reference day with this weekday
    const probe = slotStarts({ ...s, daysOff: [] }, `2030-01-${String(WEEKDAYS.indexOf(d) + 7).padStart(2, "0")}`);
    if (!probe.length) errors.push(`hours.${d}: интервал ${h.open}–${h.close} короче слота доставки (${s.delivery.slotMinutes} мин)`);
  }
  const mins = [...s.advance.discounts].map((d) => d.minQty);
  if (new Set(mins).size !== mins.length) errors.push('advance.discounts: одинаковое «от количества» у двух скидок');
  if (s.delivery.minLeadMinutes < 60) errors.push('delivery.minLeadMinutes: доставка не может быть раньше чем через час');

  for (const rel of localMedia(t)) {
    const p = join(dir, rel);
    if (!existsSync(p)) { errors.push(`Нет файла ${rel}`); continue; }
    const size = statSync(p).size;
    if (size > 3 * 1024 * 1024) errors.push(`${rel}: ${(size / 1048576).toFixed(1)} МБ — уменьшите фото до 3 МБ`);
    if (rel.endsWith('.svg')) continue;
    try {
      const m = await sharp(p).metadata();
      const min = rel === s.heroPhoto ? 1000 : 500;
      if ((m.width ?? 0) < min) warnings.push(`${rel}: ширина ${m.width}px, лучше от ${min}px`);
    } catch {
      errors.push(`${rel}: файл не похож на изображение`);
    }
  }
  if (!t.owner.email) errors.push('owner.email: укажите почту владельца — по ней создаётся вход в кабинет');
  // leftovers from tenants/_template
  if (s.phone === '+79000000000') errors.push('settings.phone: замените телефон из шаблона');
  if (/^Город, улица/.test(s.address)) errors.push('settings.address: замените адрес из шаблона');
  if (/Расскажите о магазине/.test(s.description)) errors.push('settings.description: замените описание из шаблона');
  if (s.reviews.some((r) => /Замените на настоящий отзыв/.test(r.text))) errors.push('settings.reviews: замените отзыв-заглушку настоящими отзывами с Яндекс Карт (или удалите)');
  if (!s.reviews.length && !s.yandex.orgId) warnings.push('Нет отзывов и yandex.orgId — блок отзывов будет скрыт');
  if (s.yandex.orgId === '') warnings.push('yandex.orgId не указан — ссылка «Все отзывы» откроет поиск на Яндекс Картах');
  return { errors, warnings, tenant: t };
}

if (import.meta.filename === process.argv[1]) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Использование: pnpm shop:check <название>');
    process.exit(1);
  }
  const r = await checkTenant(slug);
  for (const w of r.warnings) console.log(`⚠️  ${w}`);
  if (r.errors.length) {
    for (const e of r.errors) console.log(`❌ ${e}`);
    clearStamp(slug);
    console.log(`\nМагазин «${slug}» остаётся образцом. Исправьте ошибки и запустите проверку снова.`);
    process.exit(1);
  }
  writeStamp(slug);
  console.log(`✅ Магазин «${r.tenant!.settings.name}» проверен. Теперь он принимает настоящие заказы после публикации: pnpm shop:publish ${slug}`);
}
