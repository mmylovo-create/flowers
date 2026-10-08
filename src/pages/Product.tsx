import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Banner } from '@astryxdesign/core/Banner';
import { Token } from '@astryxdesign/core/Token';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { MinusIcon, PlusIcon, ShoppingBagIcon, ArrowLeftIcon } from '@phosphor-icons/react';
import { discountFor, formatRub } from '@domain';
import { useShop } from '../lib/shop';
import { useCart } from '../lib/cart';
import { CardOffer } from '../components/CardOffer';
import { SampleBanner } from '../components/common';

export default function Product() {
  const { id = '' } = useParams();
  const { shop, slug, media } = useShop();
  const cart = useCart(slug);
  const p = shop.bouquets.find((b) => b.id === id);
  const [qty, setQty] = useState(1);
  const [card, setCard] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  if (!p) {
    return <EmptyState title="Товар не найден" description="Возможно, его убрали из каталога." actions={<Button label="Все букеты" href={`/s/${slug}/bouquets`} />} />;
  }
  const isBouquet = p.kind === 'bouquet';
  const inCart = cart.lines.find((l) => l.productId === p.id)?.quantity ?? 0;
  const maxQty = Math.max(0, Math.min(99, (p.stock ?? 99) - inCart));
  const s = shop.settings;
  const nextDiscount = isBouquet ? s.advance.discounts.filter((d) => d.minQty > qty).sort((a, b) => a.minQty - b.minQty)[0] : undefined;
  const pct = isBouquet ? discountFor(s, qty) : 0;
  const cardProduct = card ? shop.bouquets.find((b) => b.id === card) : undefined;

  const add = () => {
    cart.add(p.id, qty);
    if (cardProduct) cart.add(cardProduct.id, 1, note.trim());
    setAdded(cardProduct ? `${p.name} × ${qty} и ${cardProduct.name}` : `${p.name} × ${qty}`);
    setQty(1);
    setCard(null);
    setNote('');
  };

  return (
    <VStack gap={5}>
      <SampleBanner />
      <HStack>
        <Button label={isBouquet ? 'Все букеты' : 'Каталог'} variant="ghost" icon={<ArrowLeftIcon size={18} />} href={`/s/${slug}/bouquets`} />
      </HStack>
      <div className="product">
        <div className="product__media">
          <img className="product__photo" src={media(p.photo)} alt={p.name} />
        </div>
        <VStack gap={4}>
          <VStack gap={2}>
            <Heading level={1}>{p.name}</Heading>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Text type="large" weight="bold" data-testid="product-price">{formatRub(p.price)}</Text>
              {p.inStock ? (p.stock !== null && p.stock <= 3 ? <Token label={`Осталось ${p.stock} шт.`} color="yellow" /> : <Token label="В наличии" color="green" />)
                : <Token label="Нет в наличии" color="gray" />}
            </HStack>
            {p.description ? <Text>{p.description}</Text> : null}
          </VStack>

          {p.inStock ? (
            <>
              {isBouquet ? <CardOffer value={card} onChange={setCard} note={note} onNote={setNote} /> : null}
              <HStack gap={3} justify="between" vAlign="center">
                <Text weight="semibold">Количество</Text>
                <span className="qty">
                  <IconButton label="Меньше" icon={<MinusIcon size={20} />} onClick={() => setQty((q) => Math.max(1, q - 1))} isDisabled={qty <= 1} />
                  <span className="qty__value" aria-live="polite" data-testid="qty">{qty}</span>
                  <IconButton label="Больше" icon={<PlusIcon size={20} />} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} isDisabled={qty >= maxQty} />
                </span>
              </HStack>
              {pct ? <Text color="accent" weight="semibold">Скидка {pct}% за количество</Text> : null}
              {nextDiscount ? <Text color="secondary">От {nextDiscount.minQty} букетов в заказе — скидка {nextDiscount.percent}%</Text> : null}
              <Button
                label={`В корзину · ${formatRub(p.price * qty + (cardProduct?.price ?? 0))}`}
                variant="primary"
                size="lg"
                width="100%"
                icon={<ShoppingBagIcon size={20} />}
                onClick={add}
                isDisabled={maxQty < 1}
                data-testid="add-to-cart"
              />
              {inCart ? <Text color="secondary">Уже в корзине: {inCart} шт.</Text> : null}
              {added ? (
                <Banner
                  status="success"
                  title="Добавлено в корзину"
                  description={added}
                  endContent={<Button label="Оформить заказ" variant="primary" href={`/s/${slug}/order`} />}
                />
              ) : null}
            </>
          ) : (
            <Banner status="info" title="Сейчас нет в наличии" description="Загляните позже или выберите другой букет." />
          )}
        </VStack>
      </div>
    </VStack>
  );
}
