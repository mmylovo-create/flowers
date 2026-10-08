import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  daySlots, deliveryDays, earliestStart, normalizeContact, normalizePhone, orderInputSchema, priceOrder,
  tenantFileSchema, validateSlot, canCancel, hoursSummary,
} from '@domain';

const demo = tenantFileSchema.parse(JSON.parse(readFileSync('tenants/demo/shop.json', 'utf8')));
const s = demo.settings;
// 2026-10-08 15:58 Moscow = 12:58 UTC (Thursday)
const NOW = new Date('2026-10-08T12:58:00Z');

describe('delivery time', () => {
  it('earliest delivery is at least one hour from now', () => {
    expect(earliestStart(s, NOW).toISOString()).toBe('2026-10-08T13:58:00.000Z');
    expect(earliestStart({ ...s, delivery: { ...s.delivery, minLeadMinutes: 30 } }, NOW).getTime() - NOW.getTime()).toBe(3600_000);
  });

  it('marks slots before now+1h as unavailable, in the shop time zone', () => {
    const slots = daySlots(s, '2026-10-08', NOW, {});
    expect(slots[0].label).toBe('09:00–10:00');
    expect(slots.at(-1)!.label).toBe('20:00–21:00');
    const t1600 = slots.find((x) => x.time === '16:00')!;
    const t1700 = slots.find((x) => x.time === '17:00')!;
    expect(t1600.state).toBe('too-soon');
    expect(t1700.state).toBe('free'); // 17:00 ≥ 16:58
  });

  it('marks busy slots', () => {
    const start = daySlots(s, '2026-10-09', NOW, {})[3].start;
    const slots = daySlots(s, '2026-10-09', NOW, { [start]: 1 });
    expect(slots[3].state).toBe('busy');
    const cap2 = daySlots({ ...s, delivery: { ...s.delivery, slotCapacity: 2 } }, '2026-10-09', NOW, { [start]: 1 });
    expect(cap2[3].state).toBe('free');
  });

  it('respects days off and weekend hours', () => {
    expect(daySlots(s, '2026-12-31', NOW, {})).toEqual([]);
    expect(daySlots(s, '2026-10-10', NOW, {})[0].label).toBe('10:00–11:00'); // Saturday
    const days = deliveryDays(s, NOW);
    expect(days[0]).toMatchObject({ date: '2026-10-08', isToday: true, isOpen: true });
    expect(days.length).toBe(s.delivery.maxAdvanceDays + 1);
  });

  it('validates a slot like the database does', () => {
    expect(validateSlot(s, '2026-10-08T13:00:00.000Z', NOW)).toMatch(/час/); // 16:00 local, too soon
    expect(validateSlot(s, '2026-10-08T14:00:00.000Z', NOW)).toBeNull();
    expect(validateSlot(s, '2026-10-08T14:30:00.000Z', NOW)).toMatch(/не доставляем/);
    expect(validateSlot(s, '2026-10-08T18:00:00.000Z', NOW)).toMatch(/не доставляем/); // 21:00 = closing
  });

  it('summarises hours', () => {
    expect(hoursSummary(s)).toBe('Пн–Пт: 09:00–21:00, Сб–Вс: 10:00–20:00');
  });
});

describe('prices and discounts', () => {
  it('applies the best quantity discount and free delivery threshold', () => {
    const b = (price: number, quantity: number) => ({ price, quantity, kind: 'bouquet' as const });
    expect(priceOrder(s, [b(3200, 1)])).toMatchObject({ subtotal: 3200, discountPercent: 0, deliveryFee: 400, total: 3600 });
    expect(priceOrder(s, [b(3200, 3)])).toMatchObject({ discountPercent: 5, discount: 480, deliveryFee: 0, total: 9120 });
    expect(priceOrder(s, [b(1000, 10)])).toMatchObject({ discountPercent: 15, discount: 1500, total: 8500 });
  });

  it('counts bouquets across lines for the discount; postcards are never discounted', () => {
    const lines = [
      { price: 3200, quantity: 2, kind: 'bouquet' as const },
      { price: 4200, quantity: 1, kind: 'bouquet' as const },
      { price: 250, quantity: 2, kind: 'card' as const },
    ];
    expect(priceOrder(s, lines)).toMatchObject({
      bouquetCount: 3, bouquetsSubtotal: 10600, cardsSubtotal: 500, subtotal: 11100,
      discountPercent: 5, discount: 530, deliveryFee: 0, total: 10570,
    });
    // balloons are full price and don't count towards the bouquet discount
    expect(priceOrder(s, [{ price: 3200, quantity: 2, kind: 'bouquet' }, { price: 1750, quantity: 1, kind: 'balloon' }]))
      .toMatchObject({ bouquetCount: 2, balloonsSubtotal: 1750, discountPercent: 0, subtotal: 8150, deliveryFee: 0, total: 8150 });
    // a postcard does not count towards the 3-bouquet discount
    expect(priceOrder(s, [{ price: 1000, quantity: 2, kind: 'bouquet' }, { price: 250, quantity: 1, kind: 'card' }]))
      .toMatchObject({ discountPercent: 0, total: 2250 + 400 });
  });
});

describe('customer input', () => {
  it('normalises phones and contacts', () => {
    expect(normalizePhone('8 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizePhone('+7 999 123 45 6')).toBeNull();
    expect(normalizeContact('telegram', 'https://t.me/anna_flowers')).toBe('@anna_flowers');
    expect(normalizeContact('telegram', '@ann')).toBeNull();
    expect(normalizeContact('vk', 'https://vk.com/id12345')).toBe('id12345');
  });

  it('rejects incomplete orders with readable messages', () => {
    const r = orderInputSchema.safeParse({
      shopSlug: 'demo', items: [], slotStart: '', name: 'А', phone: '123',
      contactChannel: 'telegram', contactHandle: 'x', address: '', deliveryConfirmed: false, idempotencyKey: crypto.randomUUID(),
    });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/Корзина пуста/);
    expect(msgs).toMatch(/время доставки/);
    expect(msgs).toMatch(/Телефон/);
    expect(msgs).toMatch(/Подтвердите доставку/);
  });

  it('cancel rules', () => {
    const slot = '2026-10-09T12:00:00.000Z';
    expect(canCancel(s, { status: 'new', slotStart: slot }, new Date('2026-10-09T09:59:00Z'))).toBe(true);
    expect(canCancel(s, { status: 'new', slotStart: slot }, new Date('2026-10-09T10:01:00Z'))).toBe(false);
    expect(canCancel(s, { status: 'done', slotStart: slot }, NOW)).toBe(false);
  });
});
