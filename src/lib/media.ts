/** Photos in shop.json are paths inside tenants/<slug>/ (served from /t/<slug>/) or full URLs (uploaded). */
export function mediaUrl(slug: string, path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  return `/t/${slug}/${path.replace(/^\.?\//, '')}`;
}
