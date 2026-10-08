import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { HouseIcon, FlowerTulipIcon, PercentIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useLiquidGlass } from './useLiquidGlass';

export function BottomNav({ slug }: { slug: string }) {
  const ref = useRef<HTMLElement>(null);
  useLiquidGlass(ref, { snapshot: 'body', zIndex: 40, resolution: 1, tint: 0.5 });
  const base = `/s/${slug}`;
  const items = [
    { to: `${base}/`, label: 'Главная', Icon: HouseIcon, end: true },
    { to: `${base}/bouquets`, label: 'Букеты', Icon: FlowerTulipIcon, end: false },
    { to: `${base}/advance`, label: 'Скидки', Icon: PercentIcon, end: false },
    { to: `${base}/orders`, label: 'Мои заказы', Icon: ReceiptIcon, end: false },
  ];
  return (
    <nav ref={ref} className="bottom-nav glass" aria-label="Основная навигация">
      {items.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className="bottom-nav__item">
          {({ isActive }) => (
            <>
              <Icon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
