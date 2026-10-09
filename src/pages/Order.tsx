import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { MinusIcon, PlusIcon, TrashIcon, ShoppingBagIcon } from '@phosphor-icons/react';
import {
  daySlots, deliveryDays, earliestStart, formatRub, MAX_CARD_TEXT, orderInputSchema,
  type ContactChannel, type OrderInput,
} from '@domain';
import { useShop } from '../lib/shop';
import { ApiError, dayRange } from '../lib/api';
import { rememberOrder } from '../lib/myOrders';
import { PageTitle, SampleBanner } from '../components/common';
import { useTelInput } from '../components/useTelInput';
import { CardOffer } from '../components/CardOffer';
import { cartDetails, useCart } from '../lib/cart';

type Fields = Partial<Record<keyof OrderInput, string>>;

function newKey() {
  return crypto.randomUUID();
}

export default function Order() {
  const { shop, slug, api, media } = useShop();
  const s = shop.settings;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cart = useCart(slug);
  const { rows, price, hasBouquet, hasCard, unavailable } = cartDetails(cart.lines, shop.bouquets, s);
  const [offerCard, setOfferCard] = useState<string | null>(null);
  const [offerNote, setOfferNote] = useState('');
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
  const idemKey = useRef<string>((() => { try { return sessionStorage.getItem(`order-key:${slug}`) ?? newKey(); } catch { return newKey(); } })());
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

  const nextDiscount = s.advance.discounts.filter((d) => d.minQty > price.bouquetCount).sort((a, b) => a.minQty - b.minQty)[0];
  const earliest = formatInTimeZone(earliestStart(s, now), s.timezone, 'HH:mm');

  const create = useMutation({
    mutationFn: (input: OrderInput) => api.createOrder(input),
    onSuccess: (order) => {
      rememberOrder(slug, order.token);
      cart.clear();
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
      shopSlug: slug,
      items: rows.map((r) => ({ productId: r.product.id, quantity: r.line.quantity, note: r.product.kind === 'card' ? r.line.note.trim() : '' })),
      slotStart: slot ?? '', name, phone, contactChannel: channel,
      contactHandle: handle, address, comment, deliveryConfirmed: confirmed, idempotencyKey: idemKey.current,
    };
    const parsed = orderInputSchema.safeParse(input);
    if (!hasBouquet) {
      setFormError('Добавьте в корзину букет или шары — открытки доставляем вместе с ними.');
      return;
    }
    if (unavailable.length) {
      setFormError(`Не хватает в наличии: ${unavailable.map((u) => u.product.name).join(', ')}. Уменьшите количество или уберите из корзины.`);
      return;
    }
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

  if (!rows.length) {
    return (
      <VStack gap={6}>
        <SampleBanner />
        <PageTitle title="Корзина" />
        <EmptyState
          icon={<ShoppingBagIcon size={40} aria-hidden />}
          title="В корзине пока пусто"
          description="Откройте букет или шары в каталоге, добавьте в корзину — и возвращайтесь сюда, чтобы выбрать время доставки."
          actions={<Button label="Открыть каталог" variant="primary" href={`/s/${slug}/catalog`} />}
        />
      </VStack>
    );
  }

  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title="Корзина и оформление" subtitle="Доставка по городу от 1 часа" />

      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <HStack justify="between" vAlign="center">
            <Heading level={2}>1. Корзина</Heading>
            <Button label="В каталог" variant="ghost" href={`/s/${slug}/catalog`} />
          </HStack>
          {rows.map(({ line, product }) => {
            const max = Math.min(99, product.stock ?? 99);
            const short = !product.inStock || (product.stock !== null && product.stock < line.quantity);
            return (
              <div className="cart-line" key={product.id} data-testid={`cart-line-${product.id}`}>
                <img className="thumb" src={media(product.photo)} alt="" />
                <div className="cart-line__body">
                  <HStack justify="between" vAlign="start" gap={2}>
                    <Text weight="semibold">{product.name}</Text>
                    <Text weight="semibold">{formatRub(product.price * line.quantity)}</Text>
                  </HStack>
                  <HStack justify="between" vAlign="center" gap={2}>
                    <span className="qty">
                      <IconButton label={`Меньше: ${product.name}`} icon={<MinusIcon size={18} />} size="sm"
                        onClick={() => cart.setQuantity(product.id, line.quantity - 1)} isDisabled={line.quantity <= 1} />
                      <span className="qty__value" aria-live="polite" data-testid={`qty-${product.id}`}>{line.quantity}</span>
                      <IconButton label={`Больше: ${product.name}`} icon={<PlusIcon size={18} />} size="sm"
                        onClick={() => cart.setQuantity(product.id, line.quantity + 1)} isDisabled={line.quantity >= max} />
                    </span>
                    <IconButton label={`Убрать ${product.name}`} icon={<TrashIcon size={18} />} variant="ghost" size="sm" onClick={() => cart.remove(product.id)} />
                  </HStack>
                  {short ? <Text color="accent">Сейчас {product.inStock ? `в наличии только ${product.stock} шт.` : 'нет в наличии'}</Text> : null}
                  {product.kind === 'card' ? (
                    <TextArea label="Текст открытки" value={line.note} onChange={(v) => cart.setNote(product.id, v)} rows={2}
                      maxLength={MAX_CARD_TEXT} isOptional placeholder="Напишем от руки" />
                  ) : null}
                </div>
              </div>
            );
          })}
          {price.discountPercent ? <Text color="accent" weight="semibold">Скидка {price.discountPercent}% на букеты за количество</Text> : null}
          {nextDiscount ? <Text color="secondary">От {nextDiscount.minQty} букетов в заказе — скидка {nextDiscount.percent}%</Text> : null}
          {!hasBouquet ? <Banner status="info" title="Добавьте букет или шары" description="Открытки доставляем вместе с букетом или шарами." /> : null}
          {hasBouquet && !hasCard ? (
            <VStack gap={3}>
              <CardOffer value={offerCard} onChange={setOfferCard} note={offerNote} onNote={setOfferNote} title="Не забыли открытку?" />
              {offerCard ? (
                <Button label="Добавить открытку в заказ" onClick={() => { cart.add(offerCard, 1, offerNote.trim()); setOfferCard(null); setOfferNote(''); }} data-testid="add-offered-card" />
              ) : null}
            </VStack>
          ) : null}
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
          <TextArea label="Комментарий" value={comment} onChange={setComment} isOptional rows={2} placeholder="Домофон, кому вручить, удобное время звонка" />
        </VStack>
      </Card>

      <Card padding={5} elevation="med">
        <VStack gap={3}>
          <Heading level={2}>4. Подтверждение</Heading>
          {rows.length ? (
            <VStack gap={1}>
              {price.bouquetsSubtotal ? <HStack justify="between"><Text>Букеты: {price.bouquetCount} шт.</Text><Text>{formatRub(price.bouquetsSubtotal)}</Text></HStack> : null}
              {price.balloonsSubtotal ? <HStack justify="between"><Text>Воздушные шары</Text><Text>{formatRub(price.balloonsSubtotal)}</Text></HStack> : null}
              {price.fireworksSubtotal ? <HStack justify="between"><Text>Фейерверки</Text><Text>{formatRub(price.fireworksSubtotal)}</Text></HStack> : null}
              {price.cardsSubtotal ? <HStack justify="between"><Text>Открытки</Text><Text>{formatRub(price.cardsSubtotal)}</Text></HStack> : null}
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
