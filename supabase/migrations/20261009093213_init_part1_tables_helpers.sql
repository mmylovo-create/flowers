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

-- Catalog: bouquets, helium balloons and postcards (kind = 'card') sold alongside them.
create table public.bouquets (
  shop_id uuid not null references public.shops(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{2,40}$'),
  kind text not null default 'bouquet' check (kind in ('bouquet', 'balloon', 'card')),
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
  bouquet_count integer not null check (bouquet_count >= 0),
  bouquets_subtotal integer not null,
  balloons_subtotal integer not null default 0,
  cards_subtotal integer not null default 0,
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

-- What was ordered, with names and prices frozen at order time.
create table public.order_items (
  order_id uuid not null references public.orders(id) on delete cascade,
  line integer not null,
  product_id text not null,
  kind text not null check (kind in ('bouquet', 'balloon', 'card')),
  name text not null,
  photo text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price integer not null,
  note text not null default '' check (char_length(note) <= 300),
  primary key (order_id, line)
);

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
alter table public.order_items enable row level security;
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
  select jsonb_build_object('id', b.id, 'kind', b.kind, 'name', b.name, 'description', b.description, 'price', b.price,
    'photo', b.photo, 'inStock', b.in_stock and (b.stock is null or b.stock > 0), 'stock', b.stock, 'sort', b.sort)
$$;

create function public.order_json(o public.orders, s public.shops) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'token', o.token, 'status', o.status,
    'createdAt', iso(o.created_at), 'slotStart', iso(o.slot_start),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('productId', i.product_id, 'kind', i.kind, 'name', i.name,
                'photo', i.photo, 'quantity', i.quantity, 'unitPrice', i.unit_price, 'note', i.note) order by i.line), '[]')
              from order_items i where i.order_id = o.id),
    'bouquetPhoto', (select i.photo from order_items i where i.order_id = o.id order by (i.kind = 'card'), (i.kind <> 'bouquet'), i.line limit 1),
    'price', jsonb_build_object('bouquetsSubtotal', o.bouquets_subtotal, 'bouquetCount', o.bouquet_count,
      'balloonsSubtotal', o.balloons_subtotal, 'cardsSubtotal', o.cards_subtotal, 'subtotal', o.subtotal,
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
create function public.discount_percent(p_settings jsonb, p_bouquets int) returns numeric
language sql immutable as $$
  select coalesce(max((t->>'percent')::numeric), 0)
  from jsonb_array_elements(coalesce(p_settings->'advance'->'discounts', '[]')) t
  where p_bouquets >= (t->>'minQty')::int
$$;
