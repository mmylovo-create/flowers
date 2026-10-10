import { useEffect, useMemo, useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { IconButton } from '@astryxdesign/core/IconButton';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import type { DeliveryDay } from '@domain';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const utc = (iso: string) => new Date(iso + 'T12:00:00Z');
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoOf(new Date(utc(iso).getTime() + n * 86_400_000));
/** Monday of the week that contains `iso`. */
const mondayOf = (iso: string) => addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));

export function longDayLabel(iso: string, todayIso?: string) {
  const d = utc(iso);
  const prefix = iso === todayIso ? 'сегодня, ' : iso === (todayIso && addDays(todayIso, 1)) ? 'завтра, ' : '';
  return `${prefix}${WD_LONG[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
}

/**
 * Delivery date as a week calendar: seven days per row, arrows to the previous/next week,
 * the chosen day filled with the accent colour. Days with no free time left are marked.
 */
export function DeliveryDatePicker({ days, value, onChange, fullDays }: {
  days: DeliveryDay[];
  value: string;
  onChange: (day: string) => void;
  /** open days where every slot is taken or already too soon */
  fullDays: Set<string>;
}) {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const weeks = useMemo(() => {
    const out: string[] = [];
    for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(m);
    return out;
  }, [first, last]);
  const weekOf = (iso: string) => Math.max(0, weeks.indexOf(mondayOf(iso)));
  const [week, setWeek] = useState(() => weekOf(value));
  // follow the selection when it changes from outside (e.g. «Выбрать ближайшее»)
  useEffect(() => { setWeek(weekOf(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const monday = weeks[week];
  const cells = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const monthLabel = (() => {
    const a = utc(cells[0]); const b = utc(cells[6]);
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`
      : `${MONTHS[a.getUTCMonth()]} — ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  })();

  return (
    <VStack gap={3} className="cal-wrap">
      <HStack justify="between" vAlign="center" gap={2}>
        <IconButton label="Предыдущая неделя" icon={<CaretLeftIcon size={20} weight="bold" />} variant="secondary"
          onClick={() => setWeek((w) => Math.max(0, w - 1))} isDisabled={week === 0} data-testid="week-prev" />
        <Text weight="semibold" className="cal__month" aria-live="polite">{monthLabel}</Text>
        <IconButton label="Следующая неделя" icon={<CaretRightIcon size={20} weight="bold" />} variant="secondary"
          onClick={() => setWeek((w) => Math.min(weeks.length - 1, w + 1))} isDisabled={week === weeks.length - 1} data-testid="week-next" />
      </HStack>
      <div className="cal" role="group" aria-label="Дата доставки">
        {WD_SHORT.map((w) => <span key={w} className="cal__wd" aria-hidden>{w}</span>)}
        {cells.map((iso) => {
          const d = byDate.get(iso);
          const inRange = !!d;
          const closed = !!d && !d.isOpen;
          const full = !!d && d.isOpen && fullDays.has(iso);
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              className="cal__day"
              data-state={!inRange ? 'out' : closed ? 'closed' : full ? 'full' : 'open'}
              data-today={iso === first || undefined}
              aria-pressed={selected}
              disabled={!inRange || closed}
              aria-label={`${longDayLabel(iso, first)}${closed ? ', выходной' : full ? ', свободного времени нет' : ''}`}
              onClick={() => onChange(iso)}
              data-testid={`day-${iso}`}
            >
              <span className="cal__num">{utc(iso).getUTCDate()}</span>
              <span className="cal__mark">{iso === first ? 'сегодня' : closed ? 'вых.' : full ? 'нет мест' : ''}</span>
            </button>
          );
        })}
      </div>
    </VStack>
  );
}
