import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { HouseIcon, SquaresFourIcon, PercentIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useLiquidGlass } from './useLiquidGlass';

export function BottomNav({ slug }: { slug: string }) {
  const ref = useRef<HTMLElement>(null);
  useLiquidGlass(ref, { snapshot: 'body', zIndex: 40, resolution: 1, tint: 0.5 });
  const base = `/s/${slug}`;
  const { pathname } = useLocation();
  // a product page belongs to the catalog
  const inCatalog = pathname.startsWith(`${base}/b/`);
  const items = [
    { to: `${base}/`, label: 'Главная', Icon: HouseIcon, end: true },
    { to: `${base}/catalog`, label: 'Каталог', Icon: SquaresFourIcon, end: false },
    { to: `${base}/advance`, label: 'Скидки', Icon: PercentIcon, end: false },
    { to: `${base}/orders`, label: 'Мои заказы', Icon: ReceiptIcon, end: false },
  ];
  return (
    <nav ref={ref} className="bottom-nav glass" aria-label="Основная навигация">
      {items.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => `bottom-nav__item${isActive || (label === 'Каталог' && inCatalog) ? ' is-active' : ''}`}>
          {({ isActive: routeActive }) => {
            const isActive = routeActive || (label === 'Каталог' && inCatalog);
            return (
            <>
              <Icon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden />
              <span>{label}</span>
            </>
            );
          }}
        </NavLink>
      ))}
    </nav>
  );
}
