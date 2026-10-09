import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Divider } from '@astryxdesign/core/Divider';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { formatPhone, formatRub, formatSlot } from '@domain';
import { useShop } from '../lib/shop';
import { ApiError } from '../lib/api';
import { rememberOrder } from '../lib/myOrders';
import { ContactSection, SampleBanner } from '../components/common';
import { StatusToken } from '../components/StatusToken';

export default function OrderDetails() {
  const { token = '' } = useParams();
  const { api, slug, shop, media } = useShop();
  const s = shop.settings;
  const created = (useLocation().state as { created?: boolean } | null)?.created;
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const q = useQuery({ queryKey: ['order', token], queryFn: () => api.order(token), refetchInterval: 30_000 });
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(token),
    onSuccess: (o) => {
      qc.setQueryData(['order', token], o);
      void qc.invalidateQueries({ queryKey: ['my-orders', slug] });
      void qc.invalidateQueries({ queryKey: ['busy', slug] });
      setConfirmOpen(false);
    },
  });
  // opening an order link on another device adds it to «Мои заказы» there too
  useEffect(() => { if (q.data) rememberOrder(slug, q.data.token); }, [q.data, slug]);
  if (q.isLoading) return <Skeleton height={320} />;
  const o = q.data;
  if (!o) return <EmptyState title="Заказ не найден" description="Проверьте ссылку или позвоните нам." />;
  const cancelled = o.status === 'cancelled_by_client' || o.status === 'cancelled_by_shop';
  return (
    <VStack gap={6}>
      <SampleBanner />
      {created ? <Banner status="success" title="Заказ оформлен!" description="Мы получили заказ и скоро свяжемся с вами для подтверждения." /> : null}
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <Heading level={1}>Заказ №{o.number}</Heading>
        <StatusToken status={o.status} />
      </HStack>
      <Card padding={5} elevation="low">
        <VStack gap={4}>
          {o.items.map((i) => (
            <HStack key={i.productId} gap={3} vAlign="center" data-testid="order-item">
              <img className="thumb" src={media(i.photo)} alt="" />
              <VStack gap={0.5}>
                <Text weight="semibold">{i.name} × {i.quantity}</Text>
                <Text color="secondary">{formatRub(i.unitPrice)} за шт.</Text>
                {i.note ? <Text>Текст открытки: «{i.note}»</Text> : null}
              </VStack>
            </HStack>
          ))}
          <MetadataList>
            <MetadataListItem label="Доставка">{formatSlot(o.slotStart, s.timezone, s.delivery.slotMinutes)}</MetadataListItem>
            <MetadataListItem label="Адрес">{o.address}</MetadataListItem>
            <MetadataListItem label="Получатель">{o.name}, {formatPhone(o.phone)}</MetadataListItem>
            <MetadataListItem label="Связь">{o.contactChannel === 'telegram' ? `Telegram ${o.contactHandle}` : `VK ${o.contactHandle}`}</MetadataListItem>
            {o.comment ? <MetadataListItem label="Комментарий">{o.comment}</MetadataListItem> : null}
          </MetadataList>
          <Divider />
          <VStack gap={1}>
            {o.price.bouquetsSubtotal ? <HStack justify="between"><Text>Букеты</Text><Text>{formatRub(o.price.bouquetsSubtotal)}</Text></HStack> : null}
            {o.price.balloonsSubtotal ? <HStack justify="between"><Text>Воздушные шары</Text><Text>{formatRub(o.price.balloonsSubtotal)}</Text></HStack> : null}
            {o.price.fireworksSubtotal ? <HStack justify="between"><Text>Фейерверки</Text><Text>{formatRub(o.price.fireworksSubtotal)}</Text></HStack> : null}
            {o.price.cardsSubtotal ? <HStack justify="between"><Text>Открытки</Text><Text>{formatRub(o.price.cardsSubtotal)}</Text></HStack> : null}
            {o.price.discount ? <HStack justify="between"><Text color="accent">Скидка {o.price.discountPercent}%</Text><Text color="accent">−{formatRub(o.price.discount)}</Text></HStack> : null}
            <HStack justify="between"><Text>Доставка</Text><Text>{o.price.deliveryFee ? formatRub(o.price.deliveryFee) : 'бесплатно'}</Text></HStack>
            <HStack justify="between"><Text weight="bold" type="large">Итого</Text><Text weight="bold" type="large">{formatRub(o.price.total)}</Text></HStack>
          </VStack>
        </VStack>
      </Card>
      {!cancelled ? (
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={2}>Отмена заказа</Heading>
            <Text color="secondary">{s.cancel.rules || `Отменить можно не позже чем за ${Math.round(s.cancel.untilMinutesBefore / 60)} ч до доставки.`}</Text>
            {o.canCancel ? (
              <>
                <Text>Можно отменить до {formatInTimeZone(new Date(o.cancelDeadline), s.timezone, 'd.MM HH:mm')}.</Text>
                <Button label="Отменить заказ" variant="destructive" onClick={() => setConfirmOpen(true)} data-testid="cancel-order" />
              </>
            ) : (
              <Text>Отменить заказ на сайте уже нельзя — позвоните нам, и мы что-нибудь придумаем.</Text>
            )}
            {cancel.isError ? <Banner status="error" title={(cancel.error as ApiError).message} /> : null}
          </VStack>
        </Card>
      ) : null}
      <AlertDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Отменить заказ?"
        description={`Заказ №${o.number} на ${formatSlot(o.slotStart, s.timezone, s.delivery.slotMinutes)} будет отменён.`}
        cancelLabel="Не отменять"
        actionLabel="Отменить заказ"
        actionVariant="destructive"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
      <ContactSection />
    </VStack>
  );
}
