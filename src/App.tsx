import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useMatch, useParams } from 'react-router-dom';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { VStack } from '@astryxdesign/core/Layout';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { TENANTS, DEFAULT_SLUG } from './generated/tenants';
import { ShopProvider, useShop } from './lib/shop';
import { shopTheme } from './lib/theme';
import { BottomNav } from './components/BottomNav';
import { TopActions } from './components/TopActions';
import { AppLink } from './components/common';
import Home from './pages/Home';

const Catalog = lazy(() => import('./pages/Catalog'));
const Order = lazy(() => import('./pages/Order'));
const MyOrders = lazy(() => import('./pages/MyOrders'));
const OrderDetails = lazy(() => import('./pages/OrderDetails'));
const Advance = lazy(() => import('./pages/Advance'));
const Product = lazy(() => import('./pages/Product'));
const Admin = lazy(() => import('./pages/admin/Admin'));
const Account = lazy(() => import('./pages/Account'));

function setHead(selector: string, attr: string, value: string, create: () => HTMLElement) {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) { el = create(); document.head.appendChild(el); }
  el.setAttribute(attr, value);
}

/** Title, colours, icon and install manifest follow the current shop (also covers in-app navigation). */
function ShopHead() {
  const { shop, slug, media } = useShop();
  const s = shop.settings;
  const base = import.meta.env.BASE_URL;
  useEffect(() => {
    document.title = s.tagline ? `${s.name} — ${s.tagline}` : s.name;
    setHead('meta[name="theme-color"]', 'content', s.theme.background, () => Object.assign(document.createElement('meta'), { name: 'theme-color' }));
    setHead('link[rel="manifest"]', 'href', `${base}t/${slug}/manifest.webmanifest`, () => Object.assign(document.createElement('link'), { rel: 'manifest' }));
    setHead('link[rel="apple-touch-icon"]', 'href', `${base}t/${slug}/apple-touch-icon.png`, () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' }));
    setHead('link[rel="icon"]', 'href', `${base}t/${slug}/favicon.png`, () => Object.assign(document.createElement('link'), { rel: 'icon' }));
    setHead('meta[name="apple-mobile-web-app-title"]', 'content', s.name, () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' }));
  }, [s, slug, media, base]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [pathname]);
  return null;
}

function ShopLayout() {
  const { slug = '' } = useParams();
  const tenant = TENANTS[slug];
  if (!tenant) {
    return (
      <main className="page">
        <EmptyState title="Магазин не найден" description="Проверьте адрес ссылки." />
      </main>
    );
  }
  return (
    <ShopProvider tenant={tenant}>
      <ThemedShop />
    </ShopProvider>
  );
}

function ThemedShop() {
  const { shop, slug } = useShop();
  const theme = useMemo(() => shopTheme(slug, shop.settings.theme), [slug, shop.settings.theme]);
  const isHome = !!useMatch('/s/:slug');
  return (
    <Theme theme={theme} mode="light">
      <ShopHead />
      <ScrollToTop />
      <a className="skip-link" href="#main">К содержимому</a>
      <main className={isHome ? 'page page--home' : 'page'} id="main">
        <Suspense fallback={<VStack gap={4}><Skeleton height={48} /><Skeleton height={320} /></VStack>}>
          <Outlet />
        </Suspense>
      </main>
      <TopActions />
      <BottomNav slug={slug} />
    </Theme>
  );
}

export default function App() {
  return (
    <LinkProvider component={AppLink}>
      <Routes>
        <Route path="/" element={DEFAULT_SLUG ? <Navigate to={`/s/${DEFAULT_SLUG}/`} replace /> : <main className="page"><EmptyState title="Нет магазинов" description="Создайте магазин: pnpm shop:new <название>" /></main>} />
        <Route path="/s/:slug" element={<ShopLayout />}>
          <Route index element={<Home />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="catalog/:category" element={<Catalog />} />
          {/* old links */}
          <Route path="bouquets" element={<Navigate to="../catalog/bouquets" replace />} />
          <Route path="b/:id" element={<Product />} />
          <Route path="order" element={<Order />} />
          <Route path="cart" element={<Order />} />
          <Route path="orders" element={<MyOrders />} />
          <Route path="orders/:token" element={<OrderDetails />} />
          <Route path="advance" element={<Advance />} />
          <Route path="account" element={<Account />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<EmptyState title="Страница не найдена" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LinkProvider>
  );
}
