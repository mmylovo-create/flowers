import { useState } from 'react';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Token } from '@astryxdesign/core/Token';
import { CalendarBlankIcon, ChatCircleDotsIcon } from '@phosphor-icons/react';
import { formatRub, priceOrder } from '@domain';
import { useShop } from '../lib/shop';
import { Assistant } from '../components/shop';
import { ContactDialog, ContactSection, PageTitle, SampleBanner } from '../components/common';
import { Reveal } from '../components/Reveal';

export default function Advance() {
  const { shop } = useShop();
  const [contactOpen, setContactOpen] = useState(false);
  const s = shop.settings;
  const sample = shop.bouquets.find((b) => b.inStock && b.kind === 'bouquet') ?? shop.bouquets.find((b) => b.kind === 'bouquet');
  return (
    <VStack gap={8}>
      <SampleBanner />
      <PageTitle title="Заранее и со скидкой" subtitle={`Бронируйте доставку до ${s.delivery.maxAdvanceDays} дней вперёд.`} />
      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <HStack gap={2} vAlign="center">
            <CalendarBlankIcon size={24} aria-hidden />
            <Heading level={2}>Цветы можно заказать заранее</Heading>
          </HStack>
          <Text>{s.advance.text || 'Выберите дату и время — мы закрепим их за вами и соберём букет в день доставки.'}</Text>
          <Button label="Связаться с нами" variant="primary" size="lg" icon={<ChatCircleDotsIcon size={20} aria-hidden />}
            onClick={() => setContactOpen(true)} data-testid="advance-contact" />
        </VStack>
      </Card>
      {s.advance.discounts.length ? (
        <Reveal>
          <VStack gap={3}>
            <Heading level={2}>Скидки от количества</Heading>
            <Card padding={0}>
              <List>
                {s.advance.discounts.map((d) => {
                  const ex = sample ? priceOrder(s, [{ price: sample.price, quantity: d.minQty, kind: 'bouquet' }]) : null;
                  return (
                    <Item key={d.minQty} align="start" label={`От ${d.minQty} букетов`} endContent={<Token label={`−${d.percent}%`} color="pink" />}
                      description={ex ? (
                        <Text color="secondary" className="discount-example">
                          Например, {d.minQty} × «{sample!.name}»:{' '}
                          <Text weight="bold" color="primary" className="nowrap">{formatRub(ex.subtotal - ex.discount)}</Text>{' '}
                          вместо <Text className="nowrap strike">{formatRub(ex.subtotal)}</Text>
                        </Text>
                      ) : undefined} />
                  );
                })}
              </List>
            </Card>
            <Text color="secondary">Скидка считается автоматически при оформлении заказа.</Text>
          </VStack>
        </Reveal>
      ) : null}
      <Reveal><ContactSection /></Reveal>
      <ContactDialog isOpen={contactOpen} onClose={() => setContactOpen(false)} />
      <Reveal><Assistant /></Reveal>
    </VStack>
  );
}
