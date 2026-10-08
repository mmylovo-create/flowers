// The basket lives on this device (no registration), one per shop.
import { useCallback, useSyncExternalStore } from 'react';
import { priceOrder, type Product, type ShopSettings } from '@domain';

export interface CartLine {
  productId: string;
  quantity: number;
  /** text for a postcard */
  note: string;
}

const key = (slug: string) => `cart:${slug}`;
const listeners = new Set<() => void>();
const EMPTY: CartLine[] = [];
const cache = new Map<string, { raw: string | null; lines: CartLine[] }>();

function read(slug: string): CartLine[] {
  let raw: string | null = null;
  const hit = cache.get(slug);
  try { raw = localStorage.getItem(key(slug)); } catch { return hit?.lines ?? EMPTY; }
  if (hit && hit.raw === raw) return hit.lines;
  let lines: CartLine[] = EMPTY;
  try {
    const v = JSON.parse(raw ?? '[]');
    if (Array.isArray(v)) {
      lines = v.filter((l) => l && typeof l.productId === 'string' && Number.isInteger(l.quantity) && l.quantity > 0)
        .map((l) => ({ productId: l.productId, quantity: Math.min(99, l.quantity), note: typeof l.note === 'string' ? l.note : '' }));
    }
  } catch { /* ignore broken data */ }
  cache.set(slug, { raw, lines });
  return lines;
}

function write(slug: string, lines: CartLine[]) {
  const raw = JSON.stringify(lines);
  try { localStorage.setItem(key(slug), raw); } catch { /* storage blocked: keep in memory */ }
  cache.set(slug, { raw, lines });
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith('cart:')) cb(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

export interface CartApi {
  lines: CartLine[];
  count: number;
  add: (productId: string, quantity?: number, note?: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  setNote: (productId: string, note: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

export function useCart(slug: string): CartApi {
  const lines = useSyncExternalStore(subscribe, () => read(slug), () => []);
  const update = useCallback((fn: (l: CartLine[]) => CartLine[]) => write(slug, fn(read(slug))), [slug]);
  return {
    lines,
    count: lines.reduce((a, l) => a + l.quantity, 0),
    add: (productId, quantity = 1, note) => update((ls) => {
      const found = ls.find((l) => l.productId === productId);
      if (found) return ls.map((l) => l.productId === productId ? { ...l, quantity: Math.min(99, l.quantity + quantity), note: note ?? l.note } : l);
      return [...ls, { productId, quantity, note: note ?? '' }];
    }),
    setQuantity: (productId, quantity) => update((ls) => quantity <= 0
      ? ls.filter((l) => l.productId !== productId)
      : ls.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(99, quantity) } : l))),
    setNote: (productId, note) => update((ls) => ls.map((l) => (l.productId === productId ? { ...l, note } : l))),
    remove: (productId) => update((ls) => ls.filter((l) => l.productId !== productId)),
    clear: () => update(() => []),
  };
}

/** Basket lines joined with the current catalog; items that left the catalog are dropped. */
export function cartDetails(lines: CartLine[], products: Product[], settings: Pick<ShopSettings, 'advance' | 'delivery'>) {
  const rows = lines
    .map((l) => ({ line: l, product: products.find((p) => p.id === l.productId) }))
    .filter((r): r is { line: CartLine; product: Product } => !!r.product);
  const price = priceOrder(settings, rows.map((r) => ({ price: r.product.price, quantity: r.line.quantity, kind: r.product.kind })));
  const hasBouquet = rows.some((r) => r.product.kind === 'bouquet');
  const hasCard = rows.some((r) => r.product.kind === 'card');
  const unavailable = rows.filter((r) => !r.product.inStock || (r.product.stock !== null && r.product.stock < r.line.quantity));
  return { rows, price, hasBouquet, hasCard, unavailable };
}
