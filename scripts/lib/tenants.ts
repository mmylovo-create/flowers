// Reading, checking and fingerprinting tenants/<slug>/ folders.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tenantFileSchema, zodIssues, type TenantFile } from '../../supabase/functions/_shared/domain/index.ts';

export const ROOT = join(import.meta.dirname, '..', '..');
export const TENANTS = join(ROOT, 'tenants');

export function tenantDir(slug: string) {
  return join(TENANTS, slug);
}

export function listTenants(): string[] {
  return readdirSync(TENANTS)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
    .filter((d) => existsSync(join(TENANTS, d, 'shop.json')))
    .sort();
}

export function readTenantRaw(slug: string): unknown {
  return JSON.parse(readFileSync(join(tenantDir(slug), 'shop.json'), 'utf8'));
}

export function loadTenant(slug: string): TenantFile {
  const parsed = tenantFileSchema.safeParse(readTenantRaw(slug));
  if (!parsed.success) throw new Error(`tenants/${slug}/shop.json:\n  ` + zodIssues(parsed.error).join('\n  '));
  return parsed.data;
}

/** Local media referenced by the tenant file (relative paths inside the tenant folder). */
export function localMedia(t: TenantFile): string[] {
  const refs = [t.settings.heroPhoto, t.settings.logo, ...t.bouquets.map((b) => b.photo)];
  return [...new Set(refs.filter((r) => r && !/^https?:\/\//.test(r)))];
}

/** Fingerprint of everything that defines the shop: shop.json + its local media. */
export function fingerprint(slug: string): string {
  const h = createHash('sha256');
  h.update(readFileSync(join(tenantDir(slug), 'shop.json')));
  try {
    const t = loadTenant(slug);
    for (const f of localMedia(t).sort()) {
      const p = join(tenantDir(slug), f);
      h.update(f + ':' + (existsSync(p) ? statSync(p).size : 'missing'));
    }
  } catch {
    /* invalid file: fingerprint of the raw json is enough */
  }
  return h.digest('hex');
}

const STAMP = '.checked';

/** A shop is "live" only after `pnpm shop:check` passed for exactly the current files. */
export function tenantStatus(slug: string): { checked: boolean; checkedAt: string | null } {
  const p = join(tenantDir(slug), STAMP);
  if (!existsSync(p)) return { checked: false, checkedAt: null };
  const s = JSON.parse(readFileSync(p, 'utf8')) as { fingerprint: string; at: string };
  return { checked: s.fingerprint === fingerprint(slug), checkedAt: s.at };
}

export function writeStamp(slug: string) {
  writeFileSync(join(tenantDir(slug), STAMP), JSON.stringify({ fingerprint: fingerprint(slug), at: new Date().toISOString() }, null, 2));
}

export function clearStamp(slug: string) {
  rmSync(join(tenantDir(slug), STAMP), { force: true });
}
