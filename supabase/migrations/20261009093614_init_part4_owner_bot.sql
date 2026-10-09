create function public.owner_orders(p_shop uuid, p_from timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  return _orders_list(p_shop, p_from);
end $$;

create function public._set_order_status(p_shop uuid, p_order uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; s shops; was_active boolean;
begin
  if p_status not in ('new', 'confirmed', 'delivering', 'done', 'cancelled_by_shop') then perform err('bad_status'); end if;
  select * into o from orders where id = p_order and shop_id = p_shop for update;
  if not found then perform err('order_not_found'); end if;
  was_active := o.status in ('new', 'confirmed', 'delivering');
  if not was_active and p_status in ('new', 'confirmed', 'delivering') then perform err('order_closed'); end if;
  update orders set status = p_status, updated_at = now() where id = o.id returning * into o;
  if was_active and p_status = 'cancelled_by_shop' then
    perform _restock(o.id);
  end if;
  select * into s from shops where id = p_shop;
  return order_json(o, s);
end $$;

create function public.owner_set_order_status(p_shop uuid, p_order uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  return _set_order_status(p_shop, p_order, p_status);
end $$;

create function public.validate_settings(p jsonb) returns void
language plpgsql stable as $$
declare wd text; h jsonb;
begin
  if jsonb_typeof(p) <> 'object' then perform err('bad_settings', 'settings'); end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 60 then perform err('bad_settings', 'name'); end if;
  if coalesce(p->>'phone', '') !~ '^\+7\d{10}$' then perform err('bad_settings', 'phone'); end if;
  if char_length(coalesce(p->>'address', '')) < 5 then perform err('bad_settings', 'address'); end if;
  if not exists (select 1 from pg_timezone_names where name = p->>'timezone') then perform err('bad_settings', 'timezone'); end if;
  if coalesce(p->>'heroPhoto', '') = '' then perform err('bad_settings', 'heroPhoto'); end if;
  if jsonb_typeof(p->'delivery') <> 'object' or jsonb_typeof(p->'cancel') <> 'object' then perform err('bad_settings', 'delivery'); end if;
  if coalesce((p->'delivery'->>'minLeadMinutes')::int, 0) < 60 then perform err('bad_settings', 'delivery.minLeadMinutes'); end if;
  foreach wd in array array['mon','tue','wed','thu','fri','sat','sun'] loop
    h := p->'hours'->wd;
    if h is null then perform err('bad_settings', 'hours.' || wd); end if;
    if jsonb_typeof(h) = 'object' and (
        coalesce(h->>'open', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(h->>'close', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
        or (h->>'open') >= (h->>'close')) then
      perform err('bad_settings', 'hours.' || wd);
    end if;
  end loop;
end $$;

create function public.owner_update_settings(p_shop uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform assert_owner(p_shop);
  perform validate_settings(p_settings);
  update shops set settings = p_settings, updated_at = now() where id = p_shop returning * into s;
  return s.settings;
end $$;

create function public._upsert_bouquet(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bouquets;
begin
  if coalesce(p->>'id', '') !~ '^[a-z0-9-]{2,40}$' then perform err('bad_bouquet', 'id'); end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 80 then perform err('bad_bouquet', 'name'); end if;
  if coalesce((p->>'price')::int, 0) <= 0 then perform err('bad_bouquet', 'price'); end if;
  if coalesce(p->>'photo', '') = '' then perform err('bad_bouquet', 'photo'); end if;
  if coalesce(p->>'kind', 'bouquet') not in ('bouquet', 'balloon', 'card') then perform err('bad_bouquet', 'kind'); end if;
  insert into bouquets (shop_id, id, kind, name, description, price, photo, in_stock, stock, sort)
  values (p_shop, p->>'id', coalesce(p->>'kind', 'bouquet'), p->>'name', left(coalesce(p->>'description', ''), 600), (p->>'price')::int, p->>'photo',
          coalesce((p->>'inStock')::boolean, true), (p->>'stock')::int, coalesce((p->>'sort')::int, 0))
  on conflict (shop_id, id) do update set kind = excluded.kind, name = excluded.name, description = excluded.description,
    price = excluded.price, photo = excluded.photo, in_stock = excluded.in_stock, stock = excluded.stock,
    sort = excluded.sort, updated_at = now()
  returning * into b;
  return bouquet_json(b);
end $$;

create function public.owner_upsert_bouquet(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  return _upsert_bouquet(p_shop, p);
end $$;

create function public._set_stock(p_shop uuid, p_bouquet text, p_in_stock boolean, p_stock int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bouquets;
begin
  if p_stock is not null and p_stock < 0 then perform err('bad_bouquet', 'stock'); end if;
  update bouquets set in_stock = p_in_stock, stock = p_stock, updated_at = now()
    where shop_id = p_shop and id = p_bouquet returning * into b;
  if not found then perform err('bouquet_not_found'); end if;
  return bouquet_json(b);
end $$;

create function public.owner_set_stock(p_shop uuid, p_bouquet text, p_in_stock boolean, p_stock int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  return _set_stock(p_shop, p_bouquet, p_in_stock, p_stock);
end $$;

-- ───────────────────────── Telegram bot (service role only) ─────────────────────────
create function public.tg_shops(p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_service();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.settings->>'name') order by s.slug), '[]')
          from telegram_links l join shops s on s.id = l.shop_id where l.chat_id = p_chat);
end $$;

create function public.tg_assert_link(p_chat bigint, p_shop uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_service();
  if not exists (select 1 from telegram_links where chat_id = p_chat and shop_id = p_shop) then perform err('forbidden'); end if;
end $$;

create function public.tg_orders(p_chat bigint, p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tg_assert_link(p_chat, p_shop);
  return _orders_list(p_shop, now() - interval '3 hours');
end $$;

create function public.tg_set_order_status(p_chat bigint, p_order uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from orders where id = p_order;
  if v_shop is null then perform err('order_not_found'); end if;
  perform tg_assert_link(p_chat, v_shop);
  return _set_order_status(v_shop, p_order, p_status);
end $$;
