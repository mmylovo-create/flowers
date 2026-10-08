import { defineTheme } from '@astryxdesign/core/theme';
import type { ShopSettings } from '@domain';

/** Astryx theme for one shop: its accent and pastel background come from shop settings. */
export function shopTheme(slug: string, t: ShopSettings['theme']) {
  return defineTheme({
    name: `shop-${slug}`,
    color: { accent: t.accent, neutralStyle: 'warm', contrast: 'standard' },
    typography: {
      scale: { base: 17, ratio: 1.2 },
      body: { family: 'Manrope', fallbacks: '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif' },
      heading: {
        family: 'Cormorant Garamond',
        fallbacks: 'Georgia, "Times New Roman", serif',
        weight: 'semibold',
        weights: { 1: 'bold', 2: 'bold' },
      },
    },
    radius: { base: 4, multiplier: 1.5 },
    motion: { fast: 175, medium: 410, slow: 975, ratio: 0.75 },
    tokens: {
      '--color-background-body': [t.background, t.background],
      '--color-background-surface': [t.surface, t.surface],
      '--color-background-card': [t.surface, t.surface],
    },
    components: {
      button: { base: { borderRadius: 'var(--radius-full)', fontWeight: 'var(--font-weight-semibold)' } },
    },
  });
}
