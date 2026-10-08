import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { GiftIcon, TruckIcon } from '@phosphor-icons/react';
import { CATEGORIES, formatRub } from '@domain';
import { Link as RouterLink } from 'react-router-dom';
import { useShop } from '../lib/shop';
import { Assistant, BouquetGrid, Hero, Reviews } from '../components/shop';
import { ContactSection, SampleBanner } from '../components/common';
import { Reveal } from '../components/Reveal';

export default function Home() {
  const { shop, slug, media } = useShop();
  const s = shop.settings;
  const featured = shop.bouquets.filter((b) => b.kind === 'bouquet').sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, 4);
  const more = CATEGORIES.filter((c) => c.kind !== 'bouquet')
    .map((c) => { const list = shop.bouquets.filter((b) => b.kind === c.kind); return { c, count: list.length, cover: list[0]?.photo }; })
    .filter((x) => x.count > 0);
  const best = s.advance.discounts.reduce((m, d) => Math.max(m, d.percent), 0);
  return (
    <VStack gap={8}>
      <SampleBanner />
      <Hero />
      <Reveal>
        <VStack gap={3}>
          <Heading level={1} type="display-2">{s.name}</Heading>
          {s.tagline ? <Text type="large" weight="semibold">{s.tagline}</Text> : null}
          {s.description ? <Text>{s.description}</Text> : null}
          <HStack gap={2} vAlign="center">
            <TruckIcon size={20} aria-hidden />
            <Text color="secondary">
              Доставка от 1 часа · {s.delivery.fee ? formatRub(s.delivery.fee) : 'бесплатно'}
              {s.delivery.freeFrom !== null ? `, бесплатно от ${formatRub(s.delivery.freeFrom)}` : ''}
            </Text>
          </HStack>
        </VStack>
      </Reveal>
      <Reveal>
        <VStack gap={4}>
          <HStack gap={3} justify="between" vAlign="center">
            <Heading level={2}>Букеты</Heading>
            <Button label="Весь каталог" variant="ghost" href={`/s/${slug}/catalog`} />
          </HStack>
          <BouquetGrid items={featured} />
          {more.length ? (
            <VStack gap={2}>
              <Text weight="semibold">Ещё в каталоге</Text>
              <div className="cat-tiles">
                {more.map(({ c, cover, count }) => (
                  <RouterLink key={c.slug} to={`/s/${slug}/catalog/${c.slug}`} className="cat-tile" data-testid={`home-category-${c.slug}`}>
                    <img src={media(cover)} alt="" />
                    <span>
                      <span className="cat-tile__title">{c.title}</span><br />
                      <span className="cat-tile__hint">{count} {count === 1 ? 'товар' : count < 5 ? 'товара' : 'товаров'}</span>
                    </span>
                  </RouterLink>
                ))}
              </div>
            </VStack>
          ) : null}
        </VStack>
      </Reveal>
      {s.advance.discounts.length ? (
        <Reveal>
          <Card padding={5} variant="muted">
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <GiftIcon size={24} aria-hidden />
                <Heading level={2}>Заранее и со скидкой до {best}%</Heading>
              </HStack>
              <Text>Закажите цветы заранее — от {s.advance.discounts[0].minQty} букетов действует скидка.</Text>
              <Button label="Подробнее о скидках" href={`/s/${slug}/advance`} />
            </VStack>
          </Card>
        </Reveal>
      ) : null}
      <Reveal><Reviews /></Reveal>
      <Reveal><ContactSection /></Reveal>
      <Reveal><Assistant /></Reveal>
    </VStack>
  );
}
