-- Functions that delete rows. Applied by hand in Supabase → SQL Editor
-- (the AI connector cancels statements containing DELETE).
-- Safe to run more than once.

-- Owner removes a product from the catalog (past orders keep their own copy of name/price/photo).
create or replace function public.owner_delete_bouquet(p_shop uuid, p_bouquet text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  delete from bouquets where shop_id = p_shop and id = p_bouquet;
end $$;

-- One-time code to link a Telegram chat; expired codes are cleaned up.
create or replace function public.owner_telegram_code(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
begin
  perform assert_owner(p_shop);
  delete from telegram_link_codes where expires_at < now();
  insert into telegram_link_codes (code, shop_id, expires_at) values (c, p_shop, now() + interval '30 minutes');
  return jsonb_build_object('code', c, 'linkedChats', (select count(*) from telegram_links where shop_id = p_shop));
end $$;

-- The bot redeems a code (once) and links the chat to the shop.
create or replace function public.tg_link(p_code text, p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c telegram_link_codes; s shops;
begin
  perform assert_service();
  select * into c from telegram_link_codes where code = lower(p_code) and expires_at > now();
  if not found then perform err('bad_code'); end if;
  insert into telegram_links (chat_id, shop_id) values (p_chat, c.shop_id) on conflict do nothing;
  delete from telegram_link_codes where code = c.code;
  select * into s from shops where id = c.shop_id;
  return jsonb_build_object('shopId', s.id, 'slug', s.slug, 'name', s.settings->>'name');
end $$;

revoke all on function public.owner_delete_bouquet(uuid, text), public.owner_telegram_code(uuid),
  public.tg_link(text, bigint) from public, anon, authenticated;
grant execute on function public.owner_delete_bouquet(uuid, text), public.owner_telegram_code(uuid) to authenticated;
grant execute on function public.owner_delete_bouquet(uuid, text), public.owner_telegram_code(uuid),
  public.tg_link(text, bigint) to service_role;

-- Owners can replace or remove their own photos.
drop policy if exists "owners delete shop media" on storage.objects;
create policy "owners delete shop media" on storage.objects for delete to authenticated
using (bucket_id = 'shop-media' and public.is_owner(((storage.foldername(name))[1])::uuid));

-- Record this step so `supabase db push` knows it is done.
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261009110000', 'delete_functions', array[]::text[]) on conflict (version) do nothing;
