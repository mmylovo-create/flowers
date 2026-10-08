import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PublicShop } from '@domain';
import { liveApi, sampleApi, type ShopApi } from './api';
import { HAS_BACKEND } from './env';
import { mediaUrl } from './media';
import type { BundledTenant } from './tenantTypes';

export interface ShopContextValue {
  slug: string;
  shop: PublicShop;
  api: ShopApi;
  mode: 'live' | 'sample';
  media: (path: string | null | undefined) => string;
  isFresh: boolean;
}

const Ctx = createContext<ShopContextValue | null>(null);

export function useShop(): ShopContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShop outside ShopProvider');
  return v;
}

const cacheKey = (slug: string) => `shop-cache:${slug}`;
function readCache(slug: string): PublicShop | null {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(slug)) ?? 'null');
  } catch {
    return null;
  }
}

export function shopMode(tenant: BundledTenant): 'live' | 'sample' {
  return tenant.checked && HAS_BACKEND ? 'live' : 'sample';
}

export function ShopProvider({ tenant, children }: { tenant: BundledTenant; children: ReactNode }) {
  const mode = shopMode(tenant);
  const api = useMemo(() => (mode === 'live' ? liveApi : sampleApi(tenant)), [mode, tenant]);
  const bundled: PublicShop = useMemo(
    () => ({ id: '', slug: tenant.slug, mode, settings: tenant.settings, bouquets: tenant.bouquets }),
    [tenant, mode],
  );
  const q = useQuery({
    queryKey: ['shop', tenant.slug, mode],
    queryFn: () => api.shop(tenant.slug),
    // Last known data (or the bundled file) shows instantly and offline; fresh data replaces it.
    initialData: () => (mode === 'live' ? readCache(tenant.slug) : null) ?? bundled,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (mode === 'live' && q.isSuccess && q.data.id) {
      try { localStorage.setItem(cacheKey(tenant.slug), JSON.stringify(q.data)); } catch { /* ignore */ }
    }
  }, [mode, q.isSuccess, q.data, tenant.slug]);

  const value = useMemo<ShopContextValue>(() => ({
    slug: tenant.slug,
    shop: q.data,
    api,
    mode,
    media: (p) => mediaUrl(tenant.slug, p),
    isFresh: q.isFetchedAfterMount,
  }), [tenant.slug, q.data, api, mode, q.isFetchedAfterMount]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
