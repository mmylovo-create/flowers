import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;

interface HeadTenant { slug: string; settings: { name: string; tagline: string; description: string; theme: { background: string } } }

function tenantsForHead(): Record<string, HeadTenant> {
  const p = join(ROOT, 'src', 'generated', 'tenants.ts');
  if (!existsSync(p)) return {};
  const src = readFileSync(p, 'utf8');
  const json = src.slice(src.indexOf('= {') + 2, src.lastIndexOf('};') + 1);
  return JSON.parse(json);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function headFor(t: HeadTenant | undefined): string {
  if (!t) return '<title>Цветы</title>';
  const s = t.settings;
  const title = s.tagline ? `${s.name} — ${s.tagline}` : s.name;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(s.description.slice(0, 160))}" />`,
    `<meta name="theme-color" content="${s.theme.background}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(s.name)}" />`,
    `<link rel="manifest" href="/t/${t.slug}/manifest.webmanifest" />`,
    `<link rel="icon" type="image/png" href="/t/${t.slug}/favicon.png" />`,
    `<link rel="apple-touch-icon" href="/t/${t.slug}/apple-touch-icon.png" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:image" content="/t/${t.slug}/icon-512.png" />`,
  ].join('\n    ');
}

/** Every shop gets its own page head (title, icon, install manifest) at /s/<slug>/. */
function tenantHtml(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tenant-html',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const m = (ctx.originalUrl ?? ctx.path ?? '').match(/^\/s\/([a-z0-9-]+)/);
        const tenants = tenantsForHead();
        const slug = m?.[1] ?? Object.keys(tenants)[0];
        return html.replace('<!--tenant-head-->', headFor(tenants[slug]));
      },
    },
    closeBundle() {
      const base = join(ROOT, outDir, 'index.html');
      if (!existsSync(base)) return;
      const html = readFileSync(base, 'utf8');
      const tenants = tenantsForHead();
      const first = headFor(tenants[Object.keys(tenants)[0]]);
      for (const [slug, t] of Object.entries(tenants)) {
        mkdirSync(join(ROOT, outDir, 's', slug), { recursive: true });
        writeFileSync(join(ROOT, outDir, 's', slug, 'index.html'), html.replace(first, headFor(t)));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    tenantHtml(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false, // each shop has its own manifest in public/t/<slug>/
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,jpg,webp,webmanifest,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@domain': join(ROOT, 'supabase/functions/_shared/domain/index.ts'),
      '@server': join(ROOT, 'supabase/functions/_shared'),
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { target: 'es2022', sourcemap: false },
});
