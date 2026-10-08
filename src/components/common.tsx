import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { ClockIcon, MapPinIcon, PhoneIcon, TelegramLogoIcon, ChatCircleIcon } from '@phosphor-icons/react';
import { formatPhone, hoursSummary, isOpenNow } from '@domain';
import { useShop } from '../lib/shop';

/** Astryx links and buttons navigate inside the app without reloading. */
export const AppLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }>(
  function AppLink({ to, href, ...rest }, ref) {
    const target = to ?? href ?? '';
    if (target.startsWith('/') && !rest.target) return <RouterLink ref={ref} to={target} {...rest} />;
    return <a ref={ref} href={target} {...rest} />;
  },
);

export function SampleBanner() {
  const { mode } = useShop();
  if (mode !== 'sample') return null;
  return (
    <Banner
      status="warning"
      title="Это образец магазина"
      description="Можно посмотреть, как всё работает: заказы сохраняются только на этом устройстве и никуда не отправляются."
    />
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <VStack gap={1}>
      <Heading level={1}>{title}</Heading>
      {subtitle ? <Text color="secondary">{subtitle}</Text> : null}
    </VStack>
  );
}

export function telegramUrl(handle: string) {
  return `https://t.me/${handle.replace(/^@/, '')}`;
}

/** «Связаться с нами»: a prominent heading over the contact + order card. */
export function ContactSection({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { shop, slug } = useShop();
  const s = shop.settings;
  const open = isOpenNow(s, new Date());
  return (
    <VStack gap={4}>
      <Heading level={headingLevel} type="display-3">Связаться с нами</Heading>
      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <HStack gap={3} vAlign="start">
            <MapPinIcon size={24} aria-hidden />
            <VStack gap={0.5}>
              <Text weight="semibold">{s.address}</Text>
              {s.delivery.zone ? <Text color="secondary">{s.delivery.zone}</Text> : null}
              {s.mapUrl ? <Button label="Открыть на карте" variant="ghost" size="sm" href={s.mapUrl} target="_blank" rel="noopener" /> : null}
            </VStack>
          </HStack>
          <HStack gap={3} vAlign="start">
            <ClockIcon size={24} aria-hidden />
            <VStack gap={1}>
              <Text weight="semibold">{hoursSummary(s)}</Text>
              <StatusDot variant={open ? 'success' : 'neutral'} label={open ? 'Сейчас открыто' : 'Сейчас закрыто'} />
            </VStack>
          </HStack>
          <VStack gap={2}>
            <Button label="Заказать букет" variant="primary" size="lg" width="100%" href={`/s/${slug}/order`} />
            <Button label={`Позвонить ${formatPhone(s.phone)}`} icon={<PhoneIcon size={20} aria-hidden />} size="lg" width="100%" href={`tel:${s.phone}`} />
            <HStack gap={2}>
              {s.telegram ? (
                <Button label="Telegram" icon={<TelegramLogoIcon size={20} aria-hidden />} size="lg" width="100%" href={telegramUrl(s.telegram)} target="_blank" rel="noopener" />
              ) : null}
              {s.vk ? (
                <Button label="VK" icon={<ChatCircleIcon size={20} aria-hidden />} size="lg" width="100%" href={`https://vk.com/${s.vk}`} target="_blank" rel="noopener" />
              ) : null}
            </HStack>
          </VStack>
        </VStack>
      </Card>
    </VStack>
  );
}
