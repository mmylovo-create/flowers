-- Photo storage: public read, owners upload only into their shop's folder: shop-media/<shop_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-media', 'shop-media', true, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true;

create policy "owners upload shop media" on storage.objects for insert to authenticated
with check (bucket_id = 'shop-media' and public.is_owner(((storage.foldername(name))[1])::uuid));

create policy "owners update shop media" on storage.objects for update to authenticated
using (bucket_id = 'shop-media' and public.is_owner(((storage.foldername(name))[1])::uuid));

grant execute on function public.is_owner(uuid) to authenticated;
