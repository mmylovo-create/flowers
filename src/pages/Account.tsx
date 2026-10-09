import { useNavigate } from 'react-router-dom';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { ReceiptIcon, SignOutIcon, StorefrontIcon } from '@phosphor-icons/react';
import { useShop } from '../lib/shop';
import { useAccount, CUSTOMER_PHONE_LOGIN } from '../lib/account';
import { supabase } from '../lib/supabase';
import { OwnerLogin } from '../components/OwnerLogin';
import { PageTitle } from '../components/common';

/**
 * «Личный кабинет». Shop staff sign in here today; the customer part (sign-in by phone number)
 * is prepared in lib/account.ts and appears when CUSTOMER_PHONE_LOGIN is switched on.
 */
export default function Account() {
  const { mode, slug, shop } = useShop();
  const navigate = useNavigate();
  const { session, role, isLoading } = useAccount(slug, mode === 'live');

  const customers = (
    <Card padding={5} elevation="low" maxWidth={440} width="100%">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <ReceiptIcon size={22} aria-hidden />
          <Heading level={2}>Покупателям</Heading>
        </HStack>
        <Text color="secondary">
          {CUSTOMER_PHONE_LOGIN
            ? 'Войдите по номеру телефона — заказы будут видны на любом устройстве.'
            : 'Регистрация не нужна: ваши заказы сохраняются на этом устройстве. Скоро здесь можно будет войти по номеру телефона.'}
        </Text>
        <Button label="Мои заказы" size="lg" width="100%" href={`/s/${slug}/orders`} />
      </VStack>
    </Card>
  );

  if (mode !== 'live') {
    return (
      <VStack gap={6}>
        <PageTitle title="Личный кабинет" />
        <Banner status="warning" title="Это образец магазина" description="Вход заработает после публикации магазина." />
        {customers}
      </VStack>
    );
  }
  if (isLoading) return <Skeleton height={320} />;

  return (
    <VStack gap={6}>
      <PageTitle title="Личный кабинет" subtitle={shop.settings.name} />
      {session && role === 'owner' ? (
        <Card padding={5} elevation="low" maxWidth={440} width="100%">
          <VStack gap={3}>
            <HStack gap={2} vAlign="center">
              <StorefrontIcon size={22} aria-hidden />
              <Heading level={2}>Вы вошли как владелец</Heading>
            </HStack>
            <Text color="secondary">{session.user.email}</Text>
            <Button label="Открыть кабинет магазина" variant="primary" size="lg" width="100%" href={`/s/${slug}/admin`} data-testid="open-cabinet" />
            <Button label="Выйти" variant="ghost" icon={<SignOutIcon size={18} />} onClick={() => void supabase().auth.signOut()} />
          </VStack>
        </Card>
      ) : session ? (
        <VStack gap={3}>
          <Banner status="error" title="Нет доступа к этому магазину" description={`Вы вошли как ${session.user.email}.`} />
          <Button label="Выйти" onClick={() => void supabase().auth.signOut()} />
        </VStack>
      ) : (
        <OwnerLogin title="Вход для магазина" subtitle="Для владельца и сотрудников: заказы, товары, цены и настройки." headingLevel={2}
          onSignedIn={() => navigate(`/s/${slug}/admin`)} />
      )}
      {customers}
    </VStack>
  );
}
