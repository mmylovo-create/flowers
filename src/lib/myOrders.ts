// "Мои заказы" without registration: the secret order tokens are kept on this device.
const key = (slug: string) => `my-orders:${slug}`;

export function myTokens(slug: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(slug)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberOrder(slug: string, token: string) {
  try {
    const list = [token, ...myTokens(slug).filter((t) => t !== token)].slice(0, 50);
    localStorage.setItem(key(slug), JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode): the order page link still works */
  }
}
