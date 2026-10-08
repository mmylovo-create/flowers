-- Flower shop ordering: schema, rules and RPC functions.
-- Browsers never touch tables directly: RLS is enabled with no policies,
-- and every read/write goes through the security-definer functions below.

-- ───────────────────────── tables ─────────────────────────
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  mode text not null default 'live' check (mode in ('live', 'sample')),
  settings jsonb not null,
  order_counter integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_owners (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (shop_id, user_id)
);

create table public.bouquets (
  shop_id uuid not null references public.shops(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 600),
  price integer not null check (price > 0),
  photo text not null,
  in_stock boolean not null default true,
  stock integer check (stock is null or stock >= 0),
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (shop_id, id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  number integer not null,
  token text not null unique,
  idempotency_key uuid not null,
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'delivering', 'done', 'cancelled_by_client', 'cancelled_by_shop')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slot_start timestamptz not null,
  slot_seq integer not null check (slot_seq >= 1),
  bouquet_id text not null,
  bouquet_name text not null,
  bouquet_photo text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price integer not null,
  subtotal integer not null,
  discount_percent numeric not null default 0,
  discount integer not null default 0,
  delivery_fee integer not null default 0,
  total integer not null,
  name text not null,
  phone text not null check (phone ~ '^\+7\d{10}$'),
  contact_channel text not null check (contact_channel in ('telegram', 'vk')),
  contact_handle text not null,
  address text not null,
  comment text not null default '',
  unique (shop_id, idempotency_key),
  unique (shop_id, number)
);
-- The guarantee against double booking: one active order per (slot, seat).
create unique index orders_one_per_slot_seat on public.orders (shop_id, slot_start, slot_seq)
  where status in ('new', 'confirmed', 'delivering');
create index orders_shop_slot on public.orders (shop_id, slot_start);

create table public.telegram_links (
  chat_id bigint not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, shop_id)
);

create table public.telegram_link_codes (
  code text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  expires_at timestamptz not null
);

create table public.telegram_sessions (
  chat_id bigint primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.outbox (
  id bigserial primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
);
create index outbox_pending on public.outbox (created_at) where sent_at is null;

alter table public.shops enable row level security;
alter table public.shop_owners enable row level security;
alter table public.bouquets enable row level security;
alter table public.orders enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_sessions enable row level security;
alter table public.outbox enable row level security;

-- ───────────────────────── helpers ─────────────────────────
create function public.err(code text, detail text default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = code, detail = coalesce(detail, code);
end $$;

create function public.is_service() returns boolean
language sql stable as $$ select coalesce(auth.role(), '') = 'service_role' $$;

create function public.is_owner(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_owners where shop_id = p_shop and user_id = auth.uid())
$$;

create function public.assert_owner(p_shop uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then perform err('not_authenticated'); end if;
  if not is_owner(p_shop) then perform err('forbidden'); end if;
end $$;

create function public.assert_service() returns void
language plpgsql stable as $$
begin
  if not public.is_service() then perform public.err('forbidden'); end if;
end $$;

create function public.iso(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create function public.bouquet_json(b public.bouquets) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'description', b.description, 'price', b.price,
    'photo', b.photo, 'inStock', b.in_stock and (b.stock is null or b.stock > 0), 'stock', b.stock, 'sort', b.sort)
$$;

create function public.order_json(o public.orders, s public.shops) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'token', o.token, 'status', o.status,
    'createdAt', iso(o.created_at), 'slotStart', iso(o.slot_start),
    'bouquetId', o.bouquet_id, 'bouquetName', o.bouquet_name, 'bouquetPhoto', o.bouquet_photo,
    'quantity', o.quantity,
    'price', jsonb_build_object('unitPrice', o.unit_price, 'quantity', o.quantity, 'subtotal', o.subtotal,
      'discountPercent', o.discount_percent, 'discount', o.discount, 'deliveryFee', o.delivery_fee, 'total', o.total),
    'name', o.name, 'phone', o.phone, 'contactChannel', o.contact_channel, 'contactHandle', o.contact_handle,
    'address', o.address, 'comment', o.comment,
    'cancelDeadline', iso(o.slot_start - make_interval(mins => coalesce((s.settings->'cancel'->>'untilMinutesBefore')::int, 120))),
    'canCancel', o.status in ('new', 'confirmed')
      and now() < o.slot_start - make_interval(mins => coalesce((s.settings->'cancel'->>'untilMinutesBefore')::int, 120)),
    'shopSlug', s.slug
  )
$$;

-- Same arithmetic as priceOrder() in supabase/functions/_shared/domain/orders.ts
create function public.discount_percent(p_settings jsonb, p_qty int) returns numeric
language sql immutable as $$
  select coalesce(max((t->>'percent')::numeric), 0)
  from jsonb_array_elements(coalesce(p_settings->'advance'->'discounts', '[]')) t
  where p_qty >= (t->>'minQty')::int
$$;

-- Returns null when the slot is valid, otherwise an error code.
create function public.slot_problem(p_settings jsonb, p_start timestamptz) returns text
language plpgsql stable as $$
declare
  tz text := p_settings->>'timezone';
  d jsonb := p_settings->'delivery';
  lead_min int := greatest(60, coalesce((d->>'minLeadMinutes')::int, 60));
  slot_min int := coalesce((d->>'slotMinutes')::int, 60);
  max_days int := coalesce((d->>'maxAdvanceDays')::int, 30);
  local_ts timestamp := p_start at time zone tz;
  local_day date := (p_start at time zone tz)::date;
  wd text := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from (p_start at time zone tz))::int];
  h jsonb := p_settings->'hours'->wd;
  open_t time; close_t time; mins int;
begin
  if p_start < now() + make_interval(mins => lead_min) then return 'too_soon'; end if;
  if local_day > (now() at time zone tz)::date + max_days then return 'too_far'; end if;
  if p_settings->'daysOff' ? local_day::text then return 'day_off'; end if;
  if h is null or jsonb_typeof(h) = 'null' then return 'day_off'; end if;
  open_t := (h->>'open')::time; close_t := (h->>'close')::time;
  if local_ts::time < open_t or local_ts::time + make_interval(mins => slot_min) > close_t
     or local_ts::time + make_interval(mins => slot_min) < local_ts::time then
    return 'closed';
  end if;
  mins := extract(epoch from (local_ts::time - open_t))::int / 60;
  if mins % slot_min <> 0 or extract(second from local_ts) <> 0 then return 'bad_slot'; end if;
  return null;
end $$;

-- ───────────────────────── public (anon) ─────────────────────────
create function public.shop_public(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'slug', s.slug, 'mode', s.mode, 'settings', s.settings,
    'bouquets', coalesce((select jsonb_agg(bouquet_json(b) order by b.sort, b.name)
                          from bouquets b where b.shop_id = s.id), '[]'))
  from shops s where s.slug = p_slug
$$;

create function public.busy_slots(p_slug text, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(iso(x.slot_start), x.c), '{}')
  from (
    select o.slot_start, count(*) c
    from orders o join shops s on s.id = o.shop_id
    where s.slug = p_slug and o.status in ('new', 'confirmed', 'delivering')
      and (o.slot_start at time zone (s.settings->>'timezone'))::date between p_from and least(p_to, p_from + 62)
    group by o.slot_start
  ) x
$$;

create function public.order_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select order_json(o, s) from orders o join shops s on s.id = o.shop_id where o.token = p_token
$$;

create function public.orders_by_tokens(p_tokens text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(order_json(o, s) order by o.slot_start desc), '[]')
  from orders o join shops s on s.id = o.shop_id
  where o.token = any(p_tokens[1:50])
$$;

-- ───────────────────────── ordering (server functions only) ─────────────────────────
-- One atomic operation: validates, locks the slot, reserves stock and a slot seat,
-- writes the order and its notification. Repeating the same idempotency key
-- returns the first order instead of creating a copy.
create function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s shops; b bouquets; o orders;
  v_start timestamptz; v_qty int; v_key uuid; v_problem text; v_seq int; v_cap int;
  v_sub int; v_pct numeric; v_disc int; v_fee int; v_free int; v_total int;
  v_constraint text;
begin
  perform assert_service();
  select * into s from shops where slug = p->>'shopSlug';
  if not found then perform err('shop_not_found'); end if;
  if s.mode <> 'live' then perform err('shop_is_sample'); end if;

  v_key := (p->>'idempotencyKey')::uuid;
  select * into o from orders where shop_id = s.id and idempotency_key = v_key;
  if found then return order_json(o, s) || jsonb_build_object('duplicate', true); end if;

  v_qty := (p->>'quantity')::int;
  v_start := (p->>'slotStart')::timestamptz;
  if v_qty is null or v_qty < 1 or v_qty > 99 then perform err('bad_quantity'); end if;
  if char_length(trim(coalesce(p->>'name', ''))) not between 2 and 60 then perform err('bad_name'); end if;
  if coalesce(p->>'phone', '') !~ '^\+7\d{10}$' then perform err('bad_phone'); end if;
  if coalesce(p->>'contactChannel', '') not in ('telegram', 'vk') then perform err('bad_contact'); end if;
  if (p->>'contactChannel') = 'telegram' and coalesce(p->>'contactHandle', '') !~ '^@[A-Za-z0-9_]{5,32}$' then perform err('bad_contact'); end if;
  if (p->>'contactChannel') = 'vk' and coalesce(p->>'contactHandle', '') !~ '^[A-Za-z0-9_.]{2,50}$' then perform err('bad_contact'); end if;
  if char_length(trim(coalesce(p->>'address', ''))) not between 5 and 200 then perform err('bad_address'); end if;
  if coalesce((p->>'deliveryConfirmed')::boolean, false) is not true then perform err('not_confirmed'); end if;

  v_problem := slot_problem(s.settings, v_start);
  if v_problem is not null then perform err(v_problem); end if;

  -- Serialize everyone booking this slot of this shop; the unique index is the backstop.
  perform pg_advisory_xact_lock(hashtextextended(s.id::text || '|' || iso(v_start), 0));
  perform pg_advisory_xact_lock(hashtextextended(s.id::text || '|key|' || v_key::text, 0));

  -- a parallel retry with the same key may have committed while we waited
  select * into o from orders where shop_id = s.id and idempotency_key = v_key;
  if found then return order_json(o, s) || jsonb_build_object('duplicate', true); end if;

  select * into b from bouquets where shop_id = s.id and id = p->>'bouquetId' for update;
  if not found then perform err('bouquet_not_found'); end if;
  if not b.in_stock or (b.stock is not null and b.stock < v_qty) then perform err('out_of_stock'); end if;

  v_cap := coalesce((s.settings->'delivery'->>'slotCapacity')::int, 1);
  select min(g) into v_seq from generate_series(1, v_cap) g
  where not exists (select 1 from orders x where x.shop_id = s.id and x.slot_start = v_start
                    and x.slot_seq = g and x.status in ('new', 'confirmed', 'delivering'));
  if v_seq is null then perform err('slot_busy'); end if;

  v_sub := b.price * v_qty;
  v_pct := discount_percent(s.settings, v_qty);
  v_disc := floor(v_sub * v_pct / 100);
  v_free := (s.settings->'delivery'->>'freeFrom')::int;
  v_fee := case when v_free is not null and v_sub - v_disc >= v_free then 0
                else coalesce((s.settings->'delivery'->>'fee')::int, 0) end;
  v_total := v_sub - v_disc + v_fee;

  update bouquets set stock = case when stock is null then null else stock - v_qty end, updated_at = now()
    where shop_id = s.id and id = b.id;
  update shops set order_counter = order_counter + 1 where id = s.id returning * into s;

  begin
    insert into orders (shop_id, number, token, idempotency_key, slot_start, slot_seq, bouquet_id, bouquet_name,
      bouquet_photo, quantity, unit_price, subtotal, discount_percent, discount, delivery_fee, total,
      name, phone, contact_channel, contact_handle, address, comment)
    values (s.id, s.order_counter, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), v_key,
      v_start, v_seq, b.id, b.name, b.photo, v_qty, b.price, v_sub, v_pct, v_disc, v_fee, v_total,
      trim(p->>'name'), p->>'phone', p->>'contactChannel', p->>'contactHandle', trim(p->>'address'),
      left(trim(coalesce(p->>'comment', '')), 500))
    returning * into o;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'orders_shop_id_idempotency_key_key' then
      select * into o from orders where shop_id = s.id and idempotency_key = v_key;
      return order_json(o, s) || jsonb_build_object('duplicate', true);
    end if;
    perform err('slot_busy');
  end;

  insert into outbox (shop_id, kind, payload) values (s.id, 'order_created', jsonb_build_object('orderId', o.id));
  return order_json(o, s) || jsonb_build_object('duplicate', false);
end $$;

create function public.cancel_order(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; s shops;
begin
  perform assert_service();
  select * into o from orders where token = p_token for update;
  if not found then perform err('order_not_found'); end if;
  select * into s from shops where id = o.shop_id;
  if o.status in ('cancelled_by_client', 'cancelled_by_shop') then return order_json(o, s); end if;
  if not (order_json(o, s)->>'canCancel')::boolean then perform err('cancel_too_late'); end if;
  update orders set status = 'cancelled_by_client', updated_at = now() where id = o.id returning * into o;
  update bouquets set stock = stock + o.quantity where shop_id = o.shop_id and id = o.bouquet_id and stock is not null;
  insert into outbox (shop_id, kind, payload) values (s.id, 'order_cancelled', jsonb_build_object('orderId', o.id));
  return order_json(o, s);
end $$;

-- ───────────────────────── owner (cabinet) ─────────────────────────
create function public.owner_shops() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.settings->>'name')), '[]')
  from shops s join shop_owners so on so.shop_id = s.id where so.user_id = auth.uid()
$$;

create function public._orders_list(p_shop uuid, p_from timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(order_json(o, s) order by o.slot_start), '[]')
  from orders o join shops s on s.id = o.shop_id
  where o.shop_id = p_shop and o.slot_start >= coalesce(p_from, now() - interval '1 day')
  limit 500
$$;

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
    update bouquets set stock = stock + o.quantity where shop_id = o.shop_id and id = o.bouquet_id and stock is not null;
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
  insert into bouquets (shop_id, id, name, description, price, photo, in_stock, stock, sort)
  values (p_shop, p->>'id', p->>'name', left(coalesce(p->>'description', ''), 600), (p->>'price')::int, p->>'photo',
          coalesce((p->>'inStock')::boolean, true), (p->>'stock')::int, coalesce((p->>'sort')::int, 0))
  on conflict (shop_id, id) do update set name = excluded.name, description = excluded.description,
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

create function public.owner_delete_bouquet(p_shop uuid, p_bouquet text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_shop);
  delete from bouquets where shop_id = p_shop and id = p_bouquet;
end $$;

create function public.owner_telegram_code(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
begin
  perform assert_owner(p_shop);
  delete from telegram_link_codes where expires_at < now();
  insert into telegram_link_codes (code, shop_id, expires_at) values (c, p_shop, now() + interval '30 minutes');
  return jsonb_build_object('code', c, 'linkedChats', (select count(*) from telegram_links where shop_id = p_shop));
end $$;

-- ───────────────────────── Telegram bot (service role only) ─────────────────────────
create function public.tg_link(p_code text, p_chat bigint) returns jsonb
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
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.shop_public(text), public.busy_slots(text, date, date),
  public.order_by_token(text), public.orders_by_tokens(text[]) to anon, authenticated;
grant execute on function public.owner_shops(), public.owner_orders(uuid, timestamptz),
  public.owner_set_order_status(uuid, uuid, text), public.owner_update_settings(uuid, jsonb),
  public.owner_upsert_bouquet(uuid, jsonb), public.owner_set_stock(uuid, text, boolean, int),
  public.owner_delete_bouquet(uuid, text), public.owner_telegram_code(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
-- Internal helpers called from definer functions run as the owner, so they need no grants.
