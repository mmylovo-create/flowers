// Delivery days and time slots in the shop's own time zone.
import { addDays, addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { ShopSettings, Weekday } from './config.ts';
import { WEEKDAYS } from './config.ts';

export type SlotState = 'free' | 'busy' | 'too-soon';
export interface Slot {
  /** slot start, ISO string in UTC */
  start: string;
  /** "17:00–18:00" in shop time */
  label: string;
  time: string;
  state: SlotState;
}
export interface DeliveryDay {
  date: string; // yyyy-MM-dd in shop tz
  weekday: string;
  dayLabel: string; // "8 окт"
  isToday: boolean;
  isOpen: boolean;
}

export type SlotSettings = Pick2<ShopSettings, 'timezone' | 'hours' | 'daysOff' | 'delivery'>;
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function localDay(now: Date, tz: string): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

export function weekdayOf(day: string): Weekday {
  // day is a calendar date; noon UTC avoids any DST edge
  const js = new Date(day + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7];
}

export function isDayOpen(s: SlotSettings, day: string): boolean {
  if (s.daysOff.includes(day)) return false;
  return s.hours[weekdayOf(day)] !== null;
}

/** Earliest moment a delivery may start: now + minimal lead time (at least 60 minutes). */
export function earliestStart(s: SlotSettings, now: Date): Date {
  return addMinutes(now, Math.max(60, s.delivery.minLeadMinutes));
}

export function deliveryDays(s: SlotSettings, now: Date): DeliveryDay[] {
  const today = localDay(now, s.timezone);
  const out: DeliveryDay[] = [];
  for (let i = 0; i <= s.delivery.maxAdvanceDays; i++) {
    const d = addDays(new Date(today + 'T12:00:00Z'), i);
    const date = d.toISOString().slice(0, 10);
    out.push({
      date,
      weekday: WD_RU[d.getUTCDay()],
      dayLabel: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      isToday: i === 0,
      isOpen: isDayOpen(s, date),
    });
  }
  return out;
}

/** Slot start times (UTC) for one shop-local day, ignoring availability. */
export function slotStarts(s: SlotSettings, day: string): Date[] {
  if (!isDayOpen(s, day)) return [];
  const h = s.hours[weekdayOf(day)]!;
  const open = fromZonedTime(`${day}T${h.open}:00`, s.timezone);
  const close = fromZonedTime(`${day}T${h.close}:00`, s.timezone);
  const out: Date[] = [];
  for (let t = open; addMinutes(t, s.delivery.slotMinutes) <= close; t = addMinutes(t, s.delivery.slotMinutes)) {
    out.push(t);
  }
  return out;
}

/** busy: map of slot start ISO → number of active orders in it */
export function daySlots(s: SlotSettings, day: string, now: Date, busy: Record<string, number>): Slot[] {
  const min = earliestStart(s, now);
  return slotStarts(s, day).map((t) => {
    const start = t.toISOString();
    const end = addMinutes(t, s.delivery.slotMinutes);
    const time = formatInTimeZone(t, s.timezone, 'HH:mm');
    const label = `${time}–${formatInTimeZone(end, s.timezone, 'HH:mm')}`;
    let state: SlotState = 'free';
    if (t < min) state = 'too-soon';
    else if ((busy[start] ?? 0) >= s.delivery.slotCapacity) state = 'busy';
    return { start, label, time, state };
  });
}

/** Mirrors the database check; used by the assistant and the browser. */
export function validateSlot(s: SlotSettings, startIso: string, now: Date): string | null {
  const t = new Date(startIso);
  if (Number.isNaN(t.getTime())) return 'Неверное время';
  if (t < earliestStart(s, now)) return 'Ближайшая доставка — не раньше чем через час';
  const day = localDay(t, s.timezone);
  const lastDay = localDay(addDays(now, s.delivery.maxAdvanceDays), s.timezone);
  if (day > lastDay) return 'Слишком далёкая дата';
  if (!slotStarts(s, day).some((x) => x.getTime() === t.getTime())) return 'В это время мы не доставляем';
  return null;
}

export function nextFreeSlot(
  s: SlotSettings, now: Date, busyByDay: (day: string) => Record<string, number>, lookaheadDays = 7,
): { day: string; slot: Slot } | null {
  for (const d of deliveryDays(s, now).slice(0, lookaheadDays + 1)) {
    if (!d.isOpen) continue;
    const slot = daySlots(s, d.date, now, busyByDay(d.date)).find((x) => x.state === 'free');
    if (slot) return { day: d.date, slot };
  }
  return null;
}

export function formatSlot(startIso: string, tz: string, slotMinutes: number): string {
  const t = new Date(startIso);
  const end = addMinutes(t, slotMinutes);
  const day = formatInTimeZone(t, tz, 'yyyy-MM-dd');
  const d = new Date(day + 'T12:00:00Z');
  return `${WD_RU[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${formatInTimeZone(t, tz, 'HH:mm')}–${formatInTimeZone(end, tz, 'HH:mm')}`;
}

export function hoursSummary(s: Pick2<ShopSettings, 'hours'>): string {
  const groups: { from: Weekday; to: Weekday; v: string }[] = [];
  for (const wd of WEEKDAYS) {
    const h = s.hours[wd];
    const v = h ? `${h.open}–${h.close}` : 'выходной';
    const last = groups[groups.length - 1];
    if (last && last.v === v) last.to = wd;
    else groups.push({ from: wd, to: wd, v });
  }
  const L: Record<Weekday, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
  return groups.map((g) => `${L[g.from]}${g.from !== g.to ? '–' + L[g.to] : ''}: ${g.v}`).join(', ');
}

export function isOpenNow(s: SlotSettings, now: Date): boolean {
  const day = localDay(now, s.timezone);
  if (!isDayOpen(s, day)) return false;
  const h = s.hours[weekdayOf(day)]!;
  const hm = formatInTimeZone(now, s.timezone, 'HH:mm');
  return hm >= h.open && hm < h.close;
}
