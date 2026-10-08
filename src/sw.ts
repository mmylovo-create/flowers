/// <reference lib="webworker" />
// Service worker (Workbox): the app shell, shop photos and icons work offline;
// orders always need the network.
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Pages: network first (fresh shop head and manifest), offline → cached page or the app shell.
const pages = new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 4 });
registerRoute(new NavigationRoute(async (opts) => {
  try {
    const r = await pages.handle(opts);
    if (r) return r;
  } catch { /* offline */ }
  return (await matchPrecache('/index.html')) ?? Response.error();
}, { denylist: [/^\/(rest|auth|storage|functions)\//] }));

// Photos uploaded by owners (Supabase Storage) and bundled shop photos.
registerRoute(
  ({ url, request }) => request.destination === 'image' && (url.pathname.includes('/storage/v1/object/public/') || url.pathname.startsWith('/t/')),
  new CacheFirst({ cacheName: 'shop-images', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })] }),
);

// Fonts
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({ cacheName: 'fonts', plugins: [new ExpirationPlugin({ maxEntries: 30 })] }),
);
