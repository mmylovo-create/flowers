import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CATEGORIES } from '@domain';
import { useShop } from '../lib/shop';

/**
 * Switch between catalog sections: Все · Букеты · Шары · Открытки · Фейерверки.
 * `sticky` keeps it at the top of the screen while the list scrolls; once pinned it
 * makes room for the top-right buttons (basket, «Войти»).
 */
export function CategoryTabs({ sticky = false }: { sticky?: boolean }) {
  const { shop, slug } = useShop();
  const base = `/s/${slug}/catalog`;
  const present = CATEGORIES.filter((c) => shop.bouquets.some((b) => b.kind === c.kind));
  const ref = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [pinned, setPinned] = useState(false);
  // keep the current section's chip in view (it may sit past the right edge on a phone)
  useEffect(() => {
    const r = row.current;
    const active = r?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!r || !active) return;
    const left = active.offsetLeft - (r.clientWidth - active.offsetWidth) / 2;
    r.scrollTo({ left: Math.max(0, left), behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  useEffect(() => {
    const el = ref.current;
    if (!sticky || !el) return;
    // pinned = the bar sits at its sticky offset; watch the strip just below that offset
    const top = parseFloat(getComputedStyle(el).top) || 0;
    const io = new IntersectionObserver(
      ([e]) => setPinned(e.intersectionRatio < 1 && e.boundingClientRect.top <= top + 1),
      { threshold: [1], rootMargin: `-${Math.ceil(top) + 1}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sticky]);
  return (
    <>
      <nav ref={ref} className={`cat-tabs${sticky ? ' cat-tabs--sticky' : ''}${pinned ? ' is-pinned' : ''}`} aria-label="Разделы каталога">
        <div ref={row} className="cat-tabs__row">
          <NavLink to={base} end className="cat-chip">Все</NavLink>
          {present.map((c) => (
            <NavLink key={c.slug} to={`${base}/${c.slug}`} className="cat-chip" data-testid={`category-${c.slug}`} aria-label={c.title}>
              {c.short}
              <span className="cat-chip__count">{shop.bouquets.filter((b) => b.kind === c.kind).length}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
