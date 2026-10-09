import { useState } from 'react';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { SignOutIcon } from '@phosphor-icons/react';
import { useShop } from '../../lib/shop';
import { supabase } from '../../lib/supabase';
import { useAccount } from '../../lib/account';
import { OwnerLogin } from '../../components/OwnerLogin';
import AdminOrders from './AdminOrders';
import AdminBouquets from './AdminBouquets';
import AdminShop from './AdminShop';
import AdminTelegram from './AdminTelegram';

export default function Admin() {
  const { mode, slug, shop } = useShop();
  const [tab, setTab] = useState('orders');
  const { session, ownShop: mine, isLoading } = useAccount(slug, mode === 'live');

  if (mode !== 'live') {
    return (
      <VStack gap={4}>
        <Heading level={1}>Кабинет владельца</Heading>
        <Banner status="warning" title="Это образец магазина"
          description="Кабинет заработает после проверки и публикации: pnpm shop:check и pnpm shop:publish (см. README)." />
      </VStack>
    );
  }
  if (isLoading) return <Skeleton height={240} />;
  if (!session) return <OwnerLogin />;
  if (!mine) {
    return (
      <VStack gap={4}>
        <Banner status="error" title="Нет доступа к этому магазину" description={`Вы вошли как ${session.user.email}.`} />
        <Button label="Выйти" onClick={() => void supabase().auth.signOut()} />
      </VStack>
    );
  }
  return (
    <VStack gap={5}>
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <VStack gap={0.5}>
          <Heading level={1}>{shop.settings.name}: кабинет</Heading>
          <Text color="secondary">{session.user.email}</Text>
        </VStack>
        <Button label="Выйти" variant="ghost" icon={<SignOutIcon size={18} />} onClick={() => void supabase().auth.signOut()} />
      </HStack>
      <TabList value={tab} onChange={setTab} overflow="scroll" hasDivider>
        <Tab value="orders" label="Заказы" />
        <Tab value="bouquets" label="Товары и наличие" />
        <Tab value="shop" label="Магазин" />
        <Tab value="telegram" label="Telegram" />
      </TabList>
      {tab === 'orders' ? <AdminOrders shopId={mine.id} /> : null}
      {tab === 'bouquets' ? <AdminBouquets shopId={mine.id} /> : null}
      {tab === 'shop' ? <AdminShop shopId={mine.id} /> : null}
      {tab === 'telegram' ? <AdminTelegram shopId={mine.id} /> : null}
    </VStack>
  );
}
