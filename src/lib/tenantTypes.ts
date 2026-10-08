import type { Bouquet, ShopSettings } from '@domain';

export interface BundledTenant {
  slug: string;
  settings: ShopSettings;
  bouquets: Bouquet[];
  /** passed `pnpm shop:check` for the current files */
  checked: boolean;
}
