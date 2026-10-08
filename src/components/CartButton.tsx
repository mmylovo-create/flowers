import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingBagIcon } from '@phosphor-icons/react';
import { formatRub } from '@domain';
import { useShop } from '../lib/shop';
import { cartDetails, useCart } from '../lib/cart';

/** Glass basket button in the top corner; shown while something is in the basket. */
export function CartButton() {
  const { slug, shop } = useShop();
  const cart = useCart(slug);
  const { pathname } = useLocation();
  const ref = useRef<HTMLAnchorElement>(null);
  if (!cart.count || /\/(order|cart)$/.test(pathname)) return null;
  const { price } = cartDetails(cart.lines, shop.bouquets, shop.settings);
  return (
    <Link ref={ref} to={`/s/${slug}/order`} className="cart-fab glass" aria-label={`Корзина: ${cart.count} шт., ${formatRub(price.total)}`} data-testid="cart-button">
      <ShoppingBagIcon size={22} weight="bold" aria-hidden />
      <span className="cart-fab__count">{cart.count}</span>
    </Link>
  );
}
