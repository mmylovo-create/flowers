import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Token } from '@astryxdesign/core/Token';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Grid } from '@astryxdesign/core/Grid';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CalendarCheckIcon, SparkleIcon, StarIcon } from '@phosphor-icons/react';
import { formatRub, type Bouquet } from '@domain';
import { useShop } from '../lib/shop';
import { myTokens } from '../lib/myOrders';
import { useCart } from '../lib/cart';
import { useLiquidGlass } from './useLiquidGlass';

export function Hero() {
  const { shop, slug, media } = useShop();
  const cart = useCart(slug);
  const s = shop.settings;
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const [loaded, setLoaded] = useState(0);
  // The lens refracts only the hero photo, and moves with it while the page scrolls.
  useLiquidGlass(ctaRef, { snapshot: '#hero-media', zIndex: 2, key: `${s.heroPhoto}:${loaded}`, onlyWhenVisible: true });
  return (
    <section className="hero" id="hero-media" aria-label={s.name}>
      <img
        className="hero__photo"
        src={media(s.heroPhoto)}
        alt={`Букет от ${s.name}`}
        fetchPriority="high"
        decoding="async"
        onLoad={() => setLoaded((n) => n + 1)}
      />
      {s.logo ? <img className="hero__logo" src={media(s.logo)} alt="" aria-hidden /> : null}
      <RouterLink ref={ctaRef} to={cart.count ? `/s/${slug}/order` : `/s/${slug}/catalog`} className="hero__cta glass" data-testid="hero-cta">
        <span className="hero__cta-label">
          <CalendarCheckIcon size={24} weight="bold" aria-hidden />
          Записаться
        </span>
      </RouterLink>
    </section>
  );
}

export function BouquetCard({ b }: { b: Bouquet }) {
  const { slug, media } = useShop();
  const href = `/s/${slug}/b/${b.id}`;
  return (
    <Card padding={0} elevation="low" className={`product-tile${b.inStock ? '' : ' out-of-stock'}`} data-testid={`bouquet-${b.id}`}>
      <AspectRatio ratio={1}>
        <img className="cover" src={media(b.photo)} alt={b.name} loading="lazy" decoding="async" />
      </AspectRatio>
      <VStack gap={2} padding={4}>
        <HStack gap={2} justify="between" vAlign="start">
          <Heading level={3}>
            {/* the whole tile opens the product page */}
            <RouterLink to={href} className="stretched-link">{b.name}</RouterLink>
          </Heading>
          {!b.inStock ? <Token label="Нет в наличии" color="gray" size="sm" /> : null}
        </HStack>
        {b.description ? <Text color="secondary" maxLines={3}>{b.description}</Text> : null}
        <HStack gap={3} justify="between" vAlign="center">
          <Text type="large" weight="bold">{formatRub(b.price)}</Text>
          <Button label={b.inStock ? 'Выбрать' : 'Подробнее'} variant={b.inStock ? 'primary' : 'secondary'} href={href} tabIndex={-1} aria-hidden />
        </HStack>
      </VStack>
    </Card>
  );
}

export function BouquetGrid({ items }: { items: Bouquet[] }) {
  return (
    <Grid columns={{ minWidth: 260 }} gap={4}>
      {items.map((b) => <BouquetCard key={b.id} b={b} />)}
    </Grid>
  );
}

function Stars({ n }: { n: number }) {
  return <span className="stars" aria-label={`Оценка ${n} из 5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export function Reviews() {
  const { shop } = useShop();
  const s = shop.settings;
  const y = s.yandex;
  const mapsUrl = y.orgId ? `https://yandex.ru/maps/org/${y.orgId}/reviews/` : `https://yandex.ru/maps/?text=${encodeURIComponent(`${s.name} ${s.address}`)}`;
  if (!s.reviews.length && !y.orgId) return null;
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2}>Отзывы с Яндекс Карт</Heading>
        {y.rating ? (
          <HStack gap={2} vAlign="center">
            <StarIcon size={20} weight="fill" aria-hidden color="var(--color-icon-yellow)" />
            <Text weight="semibold">{y.rating.toFixed(1).replace('.', ',')}</Text>
            {y.reviewsCount ? <Text color="secondary">· {y.reviewsCount} отзывов</Text> : null}
          </HStack>
        ) : null}
      </VStack>
      <Grid columns={{ minWidth: 260 }} gap={3}>
        {s.reviews.map((r) => (
          <Card key={r.author + r.date} padding={4}>
            <VStack gap={2}>
              <HStack gap={2} justify="between">
                <Text weight="semibold">{r.author}</Text>
                <Stars n={r.rating} />
              </HStack>
              <Blockquote>{r.text}</Blockquote>
            </VStack>
          </Card>
        ))}
      </Grid>
      {y.orgId ? (
        <iframe className="yandex-frame" title="Отзывы на Яндекс Картах" loading="lazy"
          src={`https://yandex.ru/maps-reviews-widget/${y.orgId}?comments`} />
      ) : null}
      <Button label="Все отзывы на Яндекс Картах" variant="ghost" href={mapsUrl} target="_blank" rel="noopener" />
    </VStack>
  );
}

const SUGGESTIONS = ['Когда ближайшая доставка?', 'Какие букеты есть в наличии?', 'Какие скидки?', 'Где мой заказ?'];

/** The helper answers from live shop data through our server function. */
export function Assistant() {
  const { api, slug } = useShop();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const r = await api.ask(slug, question, myTokens(slug));
      setAnswer(r.answer);
    } catch {
      setAnswer('Не получилось связаться с помощником. Позвоните нам или напишите в мессенджер.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding={5} variant="muted">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <SparkleIcon size={22} weight="fill" aria-hidden color="var(--color-icon-accent)" />
          <Heading level={3}>Спросите помощника</Heading>
        </HStack>
        <Text color="secondary">Отвечает по актуальным ценам, наличию, свободному времени доставки и вашим заказам.</Text>
        <HStack gap={2} wrap="wrap">
          {SUGGESTIONS.map((s) => (
            <Token key={s} label={s} onClick={() => { setQ(s); void ask(s); }} />
          ))}
        </HStack>
        <TextInput label="Ваш вопрос" value={q} onChange={setQ} onEnter={() => void ask(q)} placeholder="Например: сколько стоит доставка?" />
        <Button label="Спросить" variant="primary" isLoading={busy} onClick={() => void ask(q)} />
        {answer ? (
          <Card padding={4} data-testid="assistant-answer">
            <Text>{answer.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}</Text>
          </Card>
        ) : null}
      </VStack>
    </Card>
  );
}
