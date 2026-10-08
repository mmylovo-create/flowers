import type { Bouquet, OrderStatus, OrderView, ShopSettings } from '@domain';
import { ApiError } from '../../lib/api';
import { supabase } from '../../lib/supabase';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new ApiError(/^[a-z_]+$/.test(error.message) ? error.message : 'server', undefined,
    error.details && error.details !== error.message ? [{ path: error.details, message: error.details }] : []);
  return data as T;
}

export const ownerApi = {
  shops: () => rpc<{ id: string; slug: string; name: string }[]>('owner_shops'),
  orders: (shopId: string, from: string) => rpc<OrderView[]>('owner_orders', { p_shop: shopId, p_from: from }),
  setStatus: (shopId: string, orderId: string, status: OrderStatus) =>
    rpc<OrderView>('owner_set_order_status', { p_shop: shopId, p_order: orderId, p_status: status }),
  saveSettings: (shopId: string, settings: ShopSettings) => rpc<ShopSettings>('owner_update_settings', { p_shop: shopId, p_settings: settings }),
  saveBouquet: (shopId: string, b: Bouquet) => rpc<Bouquet>('owner_upsert_bouquet', { p_shop: shopId, p: b }),
  setStock: (shopId: string, id: string, inStock: boolean, stock: number | null) =>
    rpc<Bouquet>('owner_set_stock', { p_shop: shopId, p_bouquet: id, p_in_stock: inStock, p_stock: stock }),
  deleteBouquet: (shopId: string, id: string) => rpc<void>('owner_delete_bouquet', { p_shop: shopId, p_bouquet: id }),
  telegramCode: (shopId: string) => rpc<{ code: string; linkedChats: number }>('owner_telegram_code', { p_shop: shopId }),
};

/** Shrinks big photos on the phone before upload, then stores them in the shop's folder. */
export async function uploadPhoto(shopId: string, folder: string, file: File): Promise<string> {
  let blob: Blob = file;
  let ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  if (file.type !== 'image/svg+xml') {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error('encode'))), 'image/jpeg', 0.86));
      ext = 'jpg';
    } catch {
      /* keep the original file */
    }
  }
  if (blob.size > 8 * 1024 * 1024) throw new ApiError('invalid_input', 'Фото больше 8 МБ');
  const path = `${shopId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const store = supabase().storage.from('shop-media');
  const { error } = await store.upload(path, blob, { contentType: ext === 'svg' ? 'image/svg+xml' : 'image/jpeg', upsert: false });
  if (error) throw new ApiError('forbidden', 'Не удалось загрузить фото: ' + error.message);
  return store.getPublicUrl(path).data.publicUrl;
}
