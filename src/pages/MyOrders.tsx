import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { VStack } from '@astryxdesign/core/Layout';
import { Card } from '@astryxdesign/core/Card';
import { List } from '@astryxdesign/core/List';
import { Item } from '@astryxdesign/core/Item';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Banner } from '@astryxdesign/core/Banner';
import { ReceiptIcon } from '@phosphor-icons/react';
import { formatRub, formatSlot, orderSummary } from '@domain';
import { useShop } from '../lib/shop';
import { myTokens } from '../lib/myOrders';
import { PageTitle, SampleBanner } from '../components/common';
import { StatusToken } from '../components/StatusToken';

export default function MyOrders() {
  const { api, slug, shop, media } = useShop();
  const navigate = useNavigate();
  const tokens = myTokens(slug);
  const q = useQuery({ queryKey: ['my-orders', slug, tokens.join()], queryFn: () => api.orders(tokens), refetchInterval: 30_000 });
  const s = shop.settings;
  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title="Мои заказы" subtitle="Заказы, оформленные на этом устройстве. Регистрация не нужна." />
      {q.isLoading ? <Skeleton height={160} /> : q.isError ? (
        <Banner status="error" title="Не удалось загрузить заказы" description="Проверьте интернет и обновите страницу." />
      ) : q.data && q.data.length ? (
        <Card padding={0}>
          <List>
            {q.data.map((o) => (
              <Item
                key={o.token}
                startContent={<img className="thumb" src={media(o.bouquetPhoto)} alt="" />}
                label={`№${o.number} · ${orderSummary(o)}`}
                description={`${formatSlot(o.slotStart, s.timezone, s.delivery.slotMinutes)} · ${formatRub(o.price.total)}`}
                endContent={<StatusToken status={o.status} />}
                onClick={() => navigate(`/s/${slug}/orders/${o.token}`)}
                data-testid="my-order"
              />
            ))}
          </List>
        </Card>
      ) : (
        <EmptyState
          icon={<ReceiptIcon size={40} aria-hidden />}
          title="Заказов пока нет"
          description="Выберите букет и время — заказ появится здесь."
          actions={<Button label="Выбрать букет" variant="primary" href={`/s/${slug}/bouquets`} />}
        />
      )}
    </VStack>
  );
}
