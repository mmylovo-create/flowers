import { useEffect, useId, useRef, useState } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Grid } from '@astryxdesign/core/Grid';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MapPinIcon } from '@phosphor-icons/react';

export interface Address { city: string; street: string; house: string; flat: string }
export type AddressErrors = Partial<Record<keyof Address, string>>;

/** «Москва, ул. Покровка, д. 17, кв. 4» — what the courier and the owner see. */
export function formatAddress(a: Address): string {
  const parts = [a.city.trim(), a.street.trim(), a.house.trim() && `д. ${a.house.trim()}`, a.flat.trim() && `кв. ${a.flat.trim()}`];
  return parts.filter(Boolean).join(', ');
}

export function checkAddress(a: Address): AddressErrors {
  const e: AddressErrors = {};
  if (a.city.trim().length < 2) e.city = 'Укажите город';
  if (a.street.trim().length < 2) e.street = 'Укажите улицу';
  if (!a.house.trim()) e.house = 'Укажите дом';
  return e;
}

/** Yandex Geosuggest key (a browser key restricted to the site's address in the Yandex developer dashboard). */
const YANDEX_KEY = (import.meta.env.VITE_YANDEX_SUGGEST_KEY as string | undefined) ?? '';

interface Suggestion { title: string; subtitle: string; city?: string; street?: string; house?: string }

interface YandexResult {
  title?: { text?: string };
  subtitle?: { text?: string };
  address?: { component?: { name: string; kind: string[] }[] };
}

export async function yandexSuggest(city: string, query: string, signal?: AbortSignal, key = YANDEX_KEY): Promise<Suggestion[]> {
  if (!key || query.trim().length < 3) return [];
  const url = new URL('https://suggest-maps.yandex.ru/v1/suggest');
  url.search = new URLSearchParams({
    apikey: key, text: `${city ? city + ', ' : ''}${query}`, lang: 'ru', results: '6', types: 'street,house', print_address: '1', countries: 'ru',
  }).toString();
  const r = await fetch(url, { signal });
  if (!r.ok) return [];
  const j = (await r.json()) as { results?: YandexResult[] };
  return (j.results ?? []).map((x) => {
    const comp = x.address?.component ?? [];
    const pick = (kind: string) => comp.filter((c) => c.kind.includes(kind)).map((c) => c.name).pop();
    return {
      title: x.title?.text ?? '', subtitle: x.subtitle?.text ?? '',
      city: pick('LOCALITY'), street: pick('STREET'), house: pick('HOUSE'),
    };
  }).filter((x) => x.title);
}

/**
 * Delivery address as four fields: city, street, house, flat.
 * With a Yandex key, typing the street offers addresses from Yandex Maps.
 */
export function AddressFields({ value, onChange, errors, zone }: {
  value: Address; onChange: (a: Address) => void; errors: AddressErrors; zone?: string;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // search only while the customer is typing the street (not on mount, not after picking)
  const typing = useRef(false);
  const listId = useId();
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!YANDEX_KEY) return;
    if (!typing.current) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      yandexSuggest(value.city, `${value.street}${value.house ? ' ' + value.house : ''}`, ctl.signal)
        .then((r) => { setItems(r); setActive(-1); setOpen(r.length > 0); })
        .catch(() => { /* offline or blocked — typing still works */ });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value.city, value.street]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (s: Suggestion) => {
    typing.current = false;
    onChange({ ...value, city: s.city ?? value.city, street: s.street ?? s.title, house: s.house ?? value.house });
    setOpen(false);
  };

  return (
    <VStack gap={3}>
      <TextInput label="Город" value={value.city} onChange={(v) => set({ city: v })} autoComplete="address-level2" isRequired
        description={zone || undefined} status={errors.city ? { type: 'error', message: errors.city } : undefined} data-testid="addr-city" />
      <div className="suggest">
        <TextInput
          label="Улица" value={value.street} onChange={(v) => { typing.current = true; set({ street: v }); }} autoComplete="address-line1" isRequired
          placeholder={YANDEX_KEY ? 'Начните вводить — подскажем по Яндекс Картам' : 'Например, Покровка'}
          status={errors.street ? { type: 'error', message: errors.street } : undefined}
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          onKeyDown={(e: React.KeyboardEvent) => {
            if (!open) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
            if (e.key === 'Escape') setOpen(false);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          data-testid="addr-street"
        />
        {open ? (
          <ul className="suggest__list" id={listId} role="listbox" aria-label="Адреса из Яндекс Карт">
            {items.map((s, i) => (
              <li key={`${s.title}|${s.subtitle}`} role="option" aria-selected={i === active}>
                <button type="button" className="suggest__item" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
                  <MapPinIcon size={18} aria-hidden />
                  <span><span className="suggest__title">{s.title}</span>{s.subtitle ? <span className="suggest__sub">{s.subtitle}</span> : null}</span>
                </button>
              </li>
            ))}
            <li className="suggest__brand" aria-hidden>Подсказки Яндекс Карт</li>
          </ul>
        ) : null}
      </div>
      <Grid columns={2} gap={3}>
        <TextInput label="Дом" value={value.house} onChange={(v) => set({ house: v })} isRequired placeholder="17, корп. 2"
          status={errors.house ? { type: 'error', message: errors.house } : undefined} data-testid="addr-house" />
        <TextInput label="Кв. / офис" value={value.flat} onChange={(v) => set({ flat: v })} placeholder="необязательно"
          autoComplete="address-line2" data-testid="addr-flat" />
      </Grid>
    </VStack>
  );
}
