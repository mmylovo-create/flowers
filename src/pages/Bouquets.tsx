import { useState } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { useShop } from '../lib/shop';
import { BouquetGrid } from '../components/shop';
import { PageTitle, SampleBanner } from '../components/common';

export default function Bouquets() {
  const { shop } = useShop();
  const [filter, setFilter] = useState('all');
  const items = shop.bouquets.filter((b) => filter === 'all' || b.inStock);
  return (
    <VStack gap={6}>
      <SampleBanner />
      <PageTitle title="Букеты" subtitle="Цены и наличие обновляются сразу, как только их меняет флорист." />
      <SegmentedControl label="Показать" value={filter} onChange={setFilter}>
        <SegmentedControlItem value="all" label="Все" />
        <SegmentedControlItem value="stock" label="В наличии" />
      </SegmentedControl>
      {items.length ? <BouquetGrid items={items} /> : <EmptyState title="Сейчас всё раскупили" description="Загляните позже или позвоните нам — соберём букет на заказ." />}
    </VStack>
  );
}
