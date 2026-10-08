import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { EnvelopeSimpleIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { formatRub, MAX_CARD_TEXT, type Product } from '@domain';
import { useShop } from '../lib/shop';

/**
 * «Добавить открытку?» — pick one postcard (or none) and write its text.
 * Nothing is chosen in advance: the customer decides.
 */
export function CardOffer({ value, onChange, note, onNote, title = 'Добавить открытку?' }: {
  value: string | null;
  onChange: (id: string | null) => void;
  note: string;
  onNote: (v: string) => void;
  title?: string;
}) {
  const { shop, media } = useShop();
  const cards: Product[] = shop.bouquets.filter((p) => p.kind === 'card' && p.inStock);
  if (!cards.length) return null;
  return (
    <section className="card-offer" aria-labelledby="card-offer-title" data-testid="card-offer">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <EnvelopeSimpleIcon size={22} aria-hidden />
          <Heading level={2} id="card-offer-title">{title}</Heading>
        </HStack>
        <Text color="secondary">Подпишем от руки вашим текстом и вложим в букет.</Text>
        <div className="card-options" role="radiogroup" aria-label="Открытка">
          {cards.map((c) => {
            const on = value === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                className="card-option"
                onClick={() => onChange(on ? null : c.id)}
                data-testid={`card-option-${c.id}`}
              >
                <img src={media(c.photo)} alt="" className="card-option__img" />
                <span className="card-option__name">{c.name}</span>
                <span className="card-option__price">+{formatRub(c.price)}</span>
                {on ? <CheckCircleIcon size={22} weight="fill" className="card-option__check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        {value ? (
          <TextArea
            label="Текст открытки"
            value={note}
            onChange={onNote}
            rows={3}
            maxLength={MAX_CARD_TEXT}
            placeholder="Например: С днём рождения, мама! Люблю тебя"
            description={`До ${MAX_CARD_TEXT} символов. Можно оставить пустой — подпишете сами.`}
            isOptional
          />
        ) : null}
      </VStack>
    </section>
  );
}
