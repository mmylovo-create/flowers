import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { SignOutIcon } from '@phosphor-icons/react';
import { useShop } from '../../lib/shop';
import { supabase } from '../../lib/supabase';
import { ownerApi } from './ownerApi';
import AdminOrders from './AdminOrders';
import AdminBouquets from './AdminBouquets';
import AdminShop from './AdminShop';
import AdminTelegram from './AdminTelegram';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? 'Неверная почта или пароль' : 'Не удалось войти: ' + error.message);
  };
  return (
    <Card padding={6} elevation="low" maxWidth={440}>
      <VStack gap={4}>
        <Heading level={1}>Кабинет владельца</Heading>
        <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" onEnter={() => void submit()} />
        {error ? <Banner status="error" title={error} /> : null}
        <Button label="Войти" variant="primary" size="lg" width="100%" isLoading={busy} onClick={() => void submit()} data-testid="login" />
      </VStack>
    </Card>
  );
}

export default function Admin() {
  const { mode, slug, shop } = useShop();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState('orders');

  useEffect(() => {
    if (mode !== 'live') return;
    const sb = supabase();
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [mode]);

  const shops = useQuery({ queryKey: ['owner-shops', session?.user.id], queryFn: ownerApi.shops, enabled: !!session });

  if (mode !== 'live') {
    return (
      <VStack gap={4}>
        <Heading level={1}>Кабинет владельца</Heading>
        <Banner status="warning" title="Это образец магазина"
          description="Кабинет заработает после проверки и публикации: pnpm shop:check и pnpm shop:publish (см. README)." />
      </VStack>
    );
  }
  if (session === undefined) return <Skeleton height={240} />;
  if (!session) return <Login />;
  if (shops.isLoading) return <Skeleton height={240} />;
  const mine = shops.data?.find((s) => s.slug === slug);
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
