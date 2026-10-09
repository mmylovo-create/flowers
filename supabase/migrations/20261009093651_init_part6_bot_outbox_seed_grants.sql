create function public.tg_bouquets(p_chat bigint, p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tg_assert_link(p_chat, p_shop);
  return (select coalesce(jsonb_agg(bouquet_json(b) order by b.sort, b.name), '[]') from bouquets b where b.shop_id = p_shop);
end $$;

create function public.tg_set_stock(p_chat bigint, p_shop uuid, p_bouquet text, p_in_stock boolean, p_stock int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform tg_assert_link(p_chat, p_shop);
  return _set_stock(p_shop, p_bouquet, p_in_stock, p_stock);
end $$;

create function public.tg_set_price(p_chat bigint, p_shop uuid, p_bouquet text, p_price int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bouquets;
begin
  perform tg_assert_link(p_chat, p_shop);
  if p_price is null or p_price <= 0 then perform err('bad_bouquet', 'price'); end if;
  update bouquets set price = p_price, updated_at = now() where shop_id = p_shop and id = p_bouquet returning * into b;
  if not found then perform err('bouquet_not_found'); end if;
  return bouquet_json(b);
end $$;

create function public.tg_upsert_bouquet(p_chat bigint, p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform tg_assert_link(p_chat, p_shop);
  return _upsert_bouquet(p_shop, p);
end $$;

create function public.tg_session_get(p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_service();
  return (select jsonb_build_object('shopId', shop_id, 'state', state) from telegram_sessions where chat_id = p_chat);
end $$;

create function public.tg_session_set(p_chat bigint, p_shop uuid, p_state jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_service();
  insert into telegram_sessions (chat_id, shop_id, state) values (p_chat, p_shop, coalesce(p_state, '{}'))
  on conflict (chat_id) do update set shop_id = excluded.shop_id, state = excluded.state, updated_at = now();
end $$;

-- Notifications waiting to be delivered to Telegram, with the chats to send them to.
create function public.outbox_take(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform assert_service();
  with picked as (
    select x.* from outbox x where x.sent_at is null and x.attempts < 8
    order by x.id limit p_limit for update skip locked
  ), bumped as (
    update outbox x set attempts = x.attempts + 1 from picked where x.id = picked.id returning x.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'kind', b.kind,
    'order', (select order_json(o, s) from orders o join shops s on s.id = o.shop_id where o.id = (b.payload->>'orderId')::uuid),
    'shopName', (select settings->>'name' from shops where id = b.shop_id),
    'shopTimezone', (select settings->>'timezone' from shops where id = b.shop_id),
    'slotMinutes', (select coalesce((settings->'delivery'->>'slotMinutes')::int, 60) from shops where id = b.shop_id),
    'shopId', b.shop_id,
    'chats', (select coalesce(jsonb_agg(chat_id), '[]') from telegram_links where shop_id = b.shop_id)
  ) order by b.id), '[]') into r from bumped b;
  return r;
end $$;

create function public.outbox_done(p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_service();
  update outbox set sent_at = now() where id = any(p_ids);
end $$;

-- Publishing: create or refresh a shop from tenants/<slug>/shop.json
create function public.seed_shop(p jsonb, p_overwrite boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shops; b jsonb; tg bigint; created boolean := false;
begin
  perform assert_service();
  perform validate_settings(p->'settings');
  select * into s from shops where slug = p->>'slug';
  if not found then
    insert into shops (slug, settings, mode) values (p->>'slug', p->'settings', coalesce(p->>'mode', 'live')) returning * into s;
    created := true;
  elsif p_overwrite then
    update shops set settings = p->'settings', mode = coalesce(p->>'mode', 'live'), updated_at = now() where id = s.id returning * into s;
  else
    update shops set mode = coalesce(p->>'mode', 'live') where id = s.id returning * into s;
  end if;
  if created or p_overwrite then
    for b in select * from jsonb_array_elements(coalesce(p->'bouquets', '[]')) loop
      perform _upsert_bouquet(s.id, b);
    end loop;
  end if;
  for tg in select (x)::bigint from jsonb_array_elements_text(coalesce(p->'owner'->'telegramIds', '[]')) x loop
    insert into telegram_links (chat_id, shop_id) values (tg, s.id) on conflict do nothing;
  end loop;
  return jsonb_build_object('id', s.id, 'slug', s.slug, 'created', created);
end $$;

create function public.add_owner(p_shop uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_service();
  insert into shop_owners (shop_id, user_id) values (p_shop, p_user) on conflict do nothing;
end $$;

-- ───────────────────────── grants ─────────────────────────
-- Functions created later in public do not become callable by browsers automatically.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.shop_public(text), public.busy_slots(text, date, date),
  public.order_by_token(text), public.orders_by_tokens(text[]) to anon, authenticated;
grant execute on function public.owner_shops(), public.owner_orders(uuid, timestamptz),
  public.owner_set_order_status(uuid, uuid, text), public.owner_update_settings(uuid, jsonb),
  public.owner_upsert_bouquet(uuid, jsonb), public.owner_set_stock(uuid, text, boolean, int) to authenticated;
grant execute on all functions in schema public to service_role;
-- Internal helpers called from definer functions run as the owner, so they need no grants.
