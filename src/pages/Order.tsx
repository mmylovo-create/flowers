import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import {
  daySlots, deliveryDays, discountFor, earliestStart, formatRub, orderInputSchema, priceOrder,
  type ContactChannel, type OrderInput,
} from '@domain';
import { useShop } from '../lib/shop';
import { ApiError, dayRange } from '../lib/api';
import { rememberOrder } from '../lib/myOrders';
import { PageTitle, SampleBanner } from '../components/common';
import { useTelInput } from '../components/useTelInput';

type Fields = Partial<Record<keyof OrderInput, string>>;

function newKey() {
  return crypto.randomUUID();
}

export default function Order() {
  const { shop, slug, api, media } = useShop();
  const s = shop.settings;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inStock = shop.bouquets.filter((b) => b.inStock);

  const [bouquetId, setBouquetId] = useState(() => {
    const wanted = params.get('bouquet');
    return inStock.find((b) => b.id === wanted)?.id ?? inStock[0]?.id ?? '';
  });
  const [qty, setQty] = useState(1);
  const days = useMemo(() => deliveryDays(s, new Date()), [s]);
  const [day, setDay] = useState(() => days.find((d) => d.isOpen)?.date ?? days[0].date);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<ContactChannel>('telegram');
  const [handle, setHandle] = useState('');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const phoneRef = useTelInput();
  const [formError, setFormError] = useState<string | null>(null);
  // One key per checkout attempt: pressing the button twice (or a network retry) can't create a copy.
  const idemKey = useRef<string>(sessionStorage.getItem(`order-key:${slug}`) ?? newKey());
  useEffect(() => { try { sessionStorage.setItem(`order-key:${slug}`, idemKey.current); } catch { /* ignore */ } }, [slug]);

  const range = dayRange(s.timezone, s.delivery.maxAdvanceDays);
  const busyQ = useQuery({
    queryKey: ['busy', slug, range.from, range.to],
    queryFn: () => api.busy(slug, range.from, range.to),
    refetchInterval: 20_000,
  });
  // re-render each minute so "too soon" slots expire on their own
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const slots = useMemo(() => daySlots(s, day, now, busyQ.data ?? {}), [s, day, now, busyQ.data]);
  useEffect(() => {
    if (slot && !slots.some((x) => x.start === slot && x.state === 'free')) setSlot(null);
  }, [slots, slot]);

  const bouquet = shop.bouquets.find((b) => b.id === bouquetId);
  const price = bouquet ? priceOrder(s, bouquet.price, qty) : null;
  const nextDiscount = s.advance.discounts.filter((d) => d.minQty > qty).sort((a, b) => a.minQty - b.minQty)[0];
  const maxQty = Math.min(99, bouquet?.stock ?? 99);
  const earliest = formatInTimeZone(earliestStart(s, now), s.timezone, 'HH:mm');

  const create = useMutation({
    mutationFn: (input: OrderInput) => api.createOrder(input),
    onSuccess: (order) => {
      rememberOrder(slug, order.token);
      try { sessionStorage.removeItem(`order-key:${slug}`); } catch { /* ignore */ }
      idemKey.current = newKey();
      void qc.invalidateQueries({ queryKey: ['busy', slug] });
      void qc.invalidateQueries({ queryKey: ['shop', slug] });
      navigate(`/s/${slug}/orders/${order.token}`, { state: { created: true } });
    },
    onError: (e) => {
      const err = e instanceof ApiError ? e : new ApiError('network');
      if (err.code === 'slot_busy' || err.code === 'too_soon') {
        setSlot(null);
        void busyQ.refetch();
      }
      if (err.code === 'out_of_stock' || err.code === 'bouquet_not_found') void qc.invalidateQueries({ queryKey: ['shop', slug] });
      if (err.fields.length) setFields(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      // a different choice is a different attempt
      if (err.code !== 'network') idemKey.current = newKey();
      setFormError(err.message);
    },
  });

  const submit = () => {
    if (create.isPending) return;
    setFormError(null);
    const input = {
      shopSlug: slug, bouquetId, quantity: qty, slotStart: slot ?? '', name, phone, contactChannel: channel,
      contactHandle: handle, address, comment, deliveryConfirmed: confirmed, idempotencyKey: idemKey.current,
    };
    const parsed = orderInputSchema.safeParse(input);
    if (!parsed.success) {
      const f: Fields = {};
      for (const i of parsed.error.issues) f[i.path[0] as keyof OrderInput] ??= i.message;
      setFields(f);
      setFormError('Проверьте заполненные поля');
      return;
    }
    setFields({});
    create.mutate(input as OrderInput);
  };

  if (!inStock.length) {
    return (
      <VStack gap={6}>
        <PageTitle title="Оформление заказа" />
        <Banner status="info" title="Сейчас нет букетов в наличии" description="Позвоните нам — соберём букет на заказ." />
      </VStack>
    );
  }

  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title="Оформление заказа" subtitle="Доставка по городу от 1 часа" />

      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <Heading level={2}>1. Букет</Heading>
          <Selector
            label="Букет"
            value={bouquetId}
            onChange={(v) => { setBouquetId(v); setQty(1); }}
            options={inStock.map((b) => ({ value: b.id, label: `${b.name} — ${formatRub(b.price)}` }))}
          />
          {bouquet ? (
            <HStack gap={3} vAlign="center">
              <img className="thumb" src={media(bouquet.photo)} alt="" />
              <VStack gap={0.5}>
                <Text weight="semibold">{bouquet.name}</Text>
                <Text color="secondary" maxLines={2}>{bouquet.description}</Text>
              </VStack>
            </HStack>
          ) : null}
          <HStack gap={3} justify="between" vAlign="center">
            <Text weight="semibold">Количество</Text>
            <span className="qty">
              <IconButton label="Меньше" icon={<MinusIcon size={20} />} onClick={() => setQty((q) => Math.max(1, q - 1))} isDisabled={qty <= 1} />
              <span className="qty__value" aria-live="polite" data-testid="qty">{qty}</span>
              <IconButton label="Больше" icon={<PlusIcon size={20} />} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} isDisabled={qty >= maxQty} />
            </span>
          </HStack>
          {discountFor(s, qty) > 0 ? <Text color="accent" weight="semibold">Скидка {discountFor(s, qty)}% за количество</Text> : null}
          {nextDiscount ? <Text color="secondary">От {nextDiscount.minQty} шт. — скидка {nextDiscount.percent}%</Text> : null}
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <Heading level={2}>2. Дата и время доставки</Heading>
          <Text color="secondary">Ближайшая доставка — не раньше {earliest} (через час от текущего времени).</Text>
          <div className="chip-row" role="group" aria-label="Дата доставки">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                className="day-chip"
                aria-pressed={d.date === day}
                disabled={!d.isOpen}
                onClick={() => { setDay(d.date); setSlot(null); }}
                data-testid={`day-${d.date}`}
              >
                <span className="day-chip__wd">{d.isToday ? 'Сегодня' : d.weekday}</span>
                <span className="day-chip__d">{d.dayLabel}</span>
                {!d.isOpen ? <span className="day-chip__wd">выходной</span> : null}
              </button>
            ))}
          </div>
          {busyQ.isLoading ? <Skeleton height={120} /> : (
            slots.length ? (
              <div className="slot-grid" role="group" aria-label="Время доставки">
                {slots.map((x) => (
                  <button
                    key={x.start}
                    type="button"
                    className="slot"
                    data-state={x.state}
                    data-testid={`slot-${x.time}`}
                    aria-pressed={slot === x.start}
                    aria-disabled={x.state !== 'free'}
                    aria-label={`${x.label}${x.state === 'busy' ? ', занято' : x.state === 'too-soon' ? ', недоступно — раньше чем через час' : ''}`}
                    onClick={() => x.state === 'free' && setSlot(x.start)}
                  >
                    <span className="slot__time">{x.label}</span>
                    {x.state === 'busy' ? <span className="slot__note">Занято</span> : null}
                    {x.state === 'too-soon' ? <span className="slot__note">Недоступно</span> : null}
                  </button>
                ))}
              </div>
            ) : <Text color="secondary">В этот день доставки нет — выберите другой.</Text>
          )}
          <div className="legend" aria-hidden>
            <span><span className="legend__swatch" />Свободно</span>
            <span><span className="legend__swatch legend__swatch--busy" />Занято</span>
            <span><span className="legend__swatch legend__swatch--sel" />Выбрано</span>
          </div>
          {fields.slotStart && !slot ? <Text color="accent">{fields.slotStart}</Text> : null}
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <Heading level={2}>3. Ваши данные</Heading>
          <TextInput label="Имя" value={name} onChange={setName} autoComplete="name" isRequired
            status={fields.name ? { type: 'error', message: fields.name } : undefined} />
          <TextInput ref={phoneRef} label="Телефон" value={phone} onChange={setPhone} autoComplete="tel" placeholder="+7 999 123-45-67" isRequired
            status={fields.phone ? { type: 'error', message: fields.phone } : undefined} />
          <SegmentedControl label="Как с вами связаться" value={channel} onChange={(v) => setChannel(v as ContactChannel)} layout="fill">
            <SegmentedControlItem value="telegram" label="Telegram" />
            <SegmentedControlItem value="vk" label="VK" />
          </SegmentedControl>
          <TextInput
            label={channel === 'telegram' ? 'Ник в Telegram' : 'Страница VK'}
            value={handle}
            onChange={setHandle}
            placeholder={channel === 'telegram' ? '@username' : 'vk.com/username'}
            isRequired
            status={fields.contactHandle ? { type: 'error', message: fields.contactHandle } : undefined}
          />
          <TextInput label="Адрес доставки" value={address} onChange={setAddress} autoComplete="street-address" placeholder="Улица, дом, квартира" isRequired
            description={s.delivery.zone || undefined}
            status={fields.address ? { type: 'error', message: fields.address } : undefined} />
          <TextArea label="Комментарий" value={comment} onChange={setComment} isOptional rows={2} placeholder="Текст открытки, домофон, кому вручить" />
        </VStack>
      </Card>

      <Card padding={5} elevation="med">
        <VStack gap={3}>
          <Heading level={2}>4. Подтверждение</Heading>
          {price ? (
            <VStack gap={1}>
              <HStack justify="between"><Text>{bouquet?.name} × {qty}</Text><Text>{formatRub(price.subtotal)}</Text></HStack>
              {price.discount ? <HStack justify="between"><Text color="accent">Скидка {price.discountPercent}%</Text><Text color="accent">−{formatRub(price.discount)}</Text></HStack> : null}
              <HStack justify="between"><Text>Доставка</Text><Text>{price.deliveryFee ? formatRub(price.deliveryFee) : 'бесплатно'}</Text></HStack>
              <Divider />
              <HStack justify="between"><Text weight="bold" type="large">Итого</Text><Text weight="bold" type="large" data-testid="total">{formatRub(price.total)}</Text></HStack>
            </VStack>
          ) : null}
          <CheckboxInput
            label="Подтверждаю доставку"
            description={address ? `По адресу: ${address}` : 'Курьер привезёт букет в выбранный интервал'}
            value={confirmed}
            onChange={setConfirmed}
            status={fields.deliveryConfirmed ? { type: 'error', message: fields.deliveryConfirmed } : undefined}
          />
          {formError ? <Banner status="error" title={formError} /> : null}
          <Button
            label={create.isPending ? 'Оформляем…' : 'Подтвердить заказ'}
            variant="primary"
            size="lg"
            width="100%"
            isLoading={create.isPending}
            isDisabled={create.isPending}
            onClick={submit}
            data-testid="submit-order"
          />
        </VStack>
      </Card>
    </VStack>
  );
}
