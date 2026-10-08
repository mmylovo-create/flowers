import { NavLink } from 'react-router-dom';
import { CATEGORIES } from '@domain';
import { useShop } from '../lib/shop';

/**
 * Switch between catalog sections: Все · Букеты · Воздушные шары · Открытки.
 * `sticky` keeps it at the top of the screen while the list scrolls.
 */
export function CategoryTabs({ sticky = false }: { sticky?: boolean }) {
  const { shop, slug } = useShop();
  const base = `/s/${slug}/catalog`;
  const present = CATEGORIES.filter((c) => shop.bouquets.some((b) => b.kind === c.kind));
  return (
    <nav className={`cat-tabs${sticky ? ' cat-tabs--sticky' : ''}`} aria-label="Разделы каталога">
      <div className="cat-tabs__row">
        <NavLink to={base} end className="cat-chip">Все</NavLink>
        {present.map((c) => (
          <NavLink key={c.slug} to={`${base}/${c.slug}`} className="cat-chip" data-testid={`category-${c.slug}`} aria-label={c.title}>
            {c.short}
            <span className="cat-chip__count">{shop.bouquets.filter((b) => b.kind === c.kind).length}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
