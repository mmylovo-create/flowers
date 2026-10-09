import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingBagIcon, UserCircleIcon } from '@phosphor-icons/react';
import { formatRub } from '@domain';
import { useShop } from '../lib/shop';
import { cartDetails, useCart } from '../lib/cart';
import { useAccount } from '../lib/account';

/**
 * Glass buttons pinned to the top-right corner on every page: the basket (while it has items)
 * and «Войти» / «Кабинет». They stay on screen while the page scrolls; the width they take is
 * published as --top-actions-w so pinned bars (catalog sections) leave room for them.
 */
export function TopActions() {
  const { slug, shop, mode } = useShop();
  const cart = useCart(slug);
  const { pathname } = useLocation();
  const { role } = useAccount(slug, mode === 'live');
  const ref = useRef<HTMLDivElement>(null);
  const showCart = cart.count > 0 && !/\/(order|cart)$/.test(pathname);
  const inAccount = /\/(account|admin)$/.test(pathname);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--top-actions-w', `${Math.ceil(el.getBoundingClientRect().width)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--top-actions-w'); };
  }, []);

  const price = showCart ? cartDetails(cart.lines, shop.bouquets, shop.settings).price : null;
  const owner = role === 'owner';
  return (
    <div ref={ref} className="top-actions">
      {showCart && price ? (
        <Link to={`/s/${slug}/order`} className="top-btn glass" aria-label={`Корзина: ${cart.count} шт., ${formatRub(price.total)}`} data-testid="cart-button">
          <ShoppingBagIcon size={22} weight="bold" aria-hidden />
          <span className="top-btn__count">{cart.count}</span>
        </Link>
      ) : null}
      <Link to={owner ? `/s/${slug}/admin` : `/s/${slug}/account`} className="top-btn top-btn--account glass"
        aria-current={inAccount ? 'page' : undefined} data-testid="account-button">
        <UserCircleIcon size={22} weight={inAccount ? 'fill' : 'bold'} aria-hidden />
        <span>{owner ? 'Кабинет' : 'Войти'}</span>
      </Link>
    </div>
  );
}
