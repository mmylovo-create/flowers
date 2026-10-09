import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { CATEGORIES, type Product } from '@domain';
import { useShop } from '../lib/shop';
import { BouquetGrid } from '../components/shop';
import { PageTitle, SampleBanner } from '../components/common';
import { CategoryTabs } from '../components/CategoryTabs';

/** How many items a category shows on the «Все» view before «Смотреть все». */
const PREVIEW = 4;

export default function Catalog() {
  const { category } = useParams();
  const { shop, slug } = useShop();
  const [onlyInStock, setOnlyInStock] = useState(false);
  const base = `/s/${slug}/catalog`;
  const current = CATEGORIES.find((c) => c.slug === category);
  const items = (kind: Product['kind']) =>
    shop.bouquets.filter((b) => b.kind === kind && (!onlyInStock || b.inStock))
      .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.sort - b.sort);
  const present = CATEGORIES.filter((c) => shop.bouquets.some((b) => b.kind === c.kind));
  const shown = current ? [current] : present;

  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title={current?.title ?? 'Каталог'} subtitle={current?.hint ?? 'Букеты, воздушные шары, открытки и фейерверки — всё можно собрать в один заказ с одной доставкой.'} />
      <CategoryTabs sticky />
      <Switch label="Только в наличии" value={onlyInStock} onChange={setOnlyInStock} />
      {shown.map((c) => {
        const list = items(c.kind);
        const limited = current ? list : list.slice(0, PREVIEW);
        return (
          <VStack key={c.slug} gap={4} data-testid={`section-${c.slug}`}>
            {!current ? (
              <VStack gap={1}>
                <HStack justify="between" vAlign="center" gap={3}>
                  <Heading level={2}>{c.title}</Heading>
                  {list.length > PREVIEW ? <Button label={`Все ${list.length}`} variant="ghost" href={`${base}/${c.slug}`} /> : null}
                </HStack>
                <Text color="secondary">{c.hint}</Text>
              </VStack>
            ) : null}
            {limited.length ? <BouquetGrid items={limited} /> : (
              <EmptyState isCompact title="Сейчас нет в наличии" description="Загляните позже или позвоните нам — соберём на заказ." />
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}
