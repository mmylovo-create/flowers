import { useState } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { useShop } from '../lib/shop';
import { BouquetGrid } from '../components/shop';
import { PageTitle, SampleBanner } from '../components/common';

export default function Bouquets() {
  const { shop } = useShop();
  const [filter, setFilter] = useState('all');
  const visible = (kind: 'bouquet' | 'card') => shop.bouquets.filter((b) => b.kind === kind && (filter === 'all' || b.inStock));
  const bouquets = visible('bouquet');
  const cards = visible('card');
  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title="Букеты" subtitle="Откройте букет, чтобы посмотреть описание, выбрать количество и добавить открытку." />
      <SegmentedControl label="Показать" value={filter} onChange={setFilter}>
        <SegmentedControlItem value="all" label="Все" />
        <SegmentedControlItem value="stock" label="В наличии" />
      </SegmentedControl>
      {bouquets.length ? <BouquetGrid items={bouquets} /> : <EmptyState title="Сейчас всё раскупили" description="Загляните позже или позвоните нам — соберём букет на заказ." />}
      {cards.length ? (
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2} id="cards">Открытки</Heading>
            <Text color="secondary">Подпишем от руки вашим текстом и вложим в букет.</Text>
          </VStack>
          <BouquetGrid items={cards} />
        </VStack>
      ) : null}
    </VStack>
  );
}
