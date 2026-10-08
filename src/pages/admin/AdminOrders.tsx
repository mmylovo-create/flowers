import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Banner } from '@astryxdesign/core/Banner';
import { Link } from '@astryxdesign/core/Link';
import { formatPhone, formatRub, formatSlot, localDay, STATUS_LABELS, type OrderStatus, type OrderView } from '@domain';
import { useShop } from '../../lib/shop';
import { telegramUrl } from '../../components/common';
import { StatusToken } from '../../components/StatusToken';
import { ownerApi } from './ownerApi';
import type { ApiError } from '../../lib/api';

const SETTABLE: OrderStatus[] = ['new', 'confirmed', 'delivering', 'done', 'cancelled_by_shop'];

export default function AdminOrders({ shopId }: { shopId: string }) {
  const { shop } = useShop();
  const s = shop.settings;
  const qc = useQueryClient();
  const [view, setView] = useState('active');
  const from = fromZonedTime(`${localDay(new Date(), s.timezone)}T00:00:00`, s.timezone).toISOString();
  const q = useQuery({ queryKey: ['owner-orders', shopId, from], queryFn: () => ownerApi.orders(shopId, from), refetchInterval: 15_000 });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => ownerApi.setStatus(shopId, id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner-orders', shopId] }),
  });
  const list = (q.data ?? []).filter((o) => view === 'all' || ['new', 'confirmed', 'delivering'].includes(o.status));
  const fresh = (q.data ?? []).filter((o) => o.status === 'new').length;
  return (
    <VStack gap={4}>
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <Heading level={2}>Заказы с сегодняшнего дня{fresh ? ` · новых: ${fresh}` : ''}</Heading>
        <SegmentedControl label="Показать" value={view} onChange={setView}>
          <SegmentedControlItem value="active" label="Активные" />
          <SegmentedControlItem value="all" label="Все" />
        </SegmentedControl>
      </HStack>
      {setStatus.isError ? <Banner status="error" title={(setStatus.error as ApiError).message} /> : null}
      {q.isLoading ? <Skeleton height={200} /> : list.length === 0 ? (
        <EmptyState title="Заказов нет" description="Новые заказы появятся здесь и придут в Telegram." />
      ) : (
        <VStack gap={3}>
          {list.map((o: OrderView) => (
            <Card key={o.id} padding={4} data-testid="owner-order">
              <VStack gap={2}>
                <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
                  <Text weight="bold" type="large">№{o.number} · {formatSlot(o.slotStart, s.timezone, s.delivery.slotMinutes)}</Text>
                  <StatusToken status={o.status} />
                </HStack>
                <Text>{o.bouquetName} × {o.quantity} — <b>{formatRub(o.price.total)}</b>{o.price.discountPercent ? ` (скидка ${o.price.discountPercent}%)` : ''}</Text>
                <Text>{o.name}, <Link href={`tel:${o.phone}`}>{formatPhone(o.phone)}</Link>{' · '}
                  {o.contactChannel === 'telegram'
                    ? <Link href={telegramUrl(o.contactHandle)} target="_blank">{`Telegram ${o.contactHandle}`}</Link>
                    : <Link href={`https://vk.com/${o.contactHandle}`} target="_blank">{`VK ${o.contactHandle}`}</Link>}
                </Text>
                <Text color="secondary">{o.address}{o.comment ? ` · ${o.comment}` : ''}</Text>
                {['new', 'confirmed', 'delivering'].includes(o.status) ? (
                  <Selector
                    label="Статус"
                    value={o.status}
                    onChange={(v) => setStatus.mutate({ id: o.id, status: v as OrderStatus })}
                    options={SETTABLE.map((st) => ({ value: st, label: STATUS_LABELS[st] }))}
                    isDisabled={setStatus.isPending}
                  />
                ) : null}
              </VStack>
            </Card>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
