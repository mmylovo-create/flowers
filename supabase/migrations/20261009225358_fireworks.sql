-- Fireworks: a fourth catalog section. Delivered on their own like balloons, always full price
-- (the quantity discount stays on bouquets only), shown as its own line in the order total.
alter table public.bouquets drop constraint if exists bouquets_kind_check;
alter table public.bouquets add constraint bouquets_kind_check check (kind in ('bouquet', 'balloon', 'card', 'firework'));
alter table public.order_items drop constraint if exists order_items_kind_check;
alter table public.order_items add constraint order_items_kind_check check (kind in ('bouquet', 'balloon', 'card', 'firework'));
alter table public.orders add column if not exists fireworks_subtotal integer not null default 0;

create or replace function public.order_json(o public.orders, s public.shops) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'token', o.token, 'status', o.status,
    'createdAt', iso(o.created_at), 'slotStart', iso(o.slot_start),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('productId', i.product_id, 'kind', i.kind, 'name', i.name,
                'photo', i.photo, 'quantity', i.quantity, 'unitPrice', i.unit_price, 'note', i.note) order by i.line), '[]')
              from order_items i where i.order_id = o.id),
    'bouquetPhoto', (select i.photo from order_items i where i.order_id = o.id order by (i.kind = 'card'), (i.kind <> 'bouquet'), i.line limit 1),
    'price', jsonb_build_object('bouquetsSubtotal', o.bouquets_subtotal, 'bouquetCount', o.bouquet_count,
      'balloonsSubtotal', o.balloons_subtotal, 'fireworksSubtotal', o.fireworks_subtotal, 'cardsSubtotal', o.cards_subtotal, 'subtotal', o.subtotal,
      'discountPercent', o.discount_percent, 'discount', o.discount, 'deliveryFee', o.delivery_fee, 'total', o.total),
    'name', o.name, 'phone', o.phone, 'contactChannel', o.contact_channel, 'contactHandle', o.contact_handle,
    'address', o.address, 'comment', o.comment,
    'cancelDeadline', iso(o.slot_start - make_interval(mins => coalesce((s.settings->'cancel'->>'untilMinutesBefore')::int, 120))),
    'canCancel', o.status in ('new', 'confirmed')
      and now() < o.slot_start - make_interval(mins => coalesce((s.settings->'cancel'->>'untilMinutesBefore')::int, 120)),
    'shopSlug', s.slug
  )
$$;

create or replace function public._upsert_bouquet(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bouquets;
begin
  if coalesce(p->>'id', '') !~ '^[a-z0-9-]{2,40}$' then perform err('bad_bouquet', 'id'); end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 80 then perform err('bad_bouquet', 'name'); end if;
  if coalesce((p->>'price')::int, 0) <= 0 then perform err('bad_bouquet', 'price'); end if;
  if coalesce(p->>'photo', '') = '' then perform err('bad_bouquet', 'photo'); end if;
  if coalesce(p->>'kind', 'bouquet') not in ('bouquet', 'balloon', 'card', 'firework') then perform err('bad_bouquet', 'kind'); end if;
  insert into bouquets (shop_id, id, kind, name, description, price, photo, in_stock, stock, sort)
  values (p_shop, p->>'id', coalesce(p->>'kind', 'bouquet'), p->>'name', left(coalesce(p->>'description', ''), 600), (p->>'price')::int, p->>'photo',
          coalesce((p->>'inStock')::boolean, true), (p->>'stock')::int, coalesce((p->>'sort')::int, 0))
  on conflict (shop_id, id) do update set kind = excluded.kind, name = excluded.name, description = excluded.description,
    price = excluded.price, photo = excluded.photo, in_stock = excluded.in_stock, stock = excluded.stock,
    sort = excluded.sort, updated_at = now()
  returning * into b;
  return bouquet_json(b);
end $$;

create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s shops; b bouquets; o orders; it jsonb;
  v_start timestamptz; v_qty int; v_key uuid; v_problem text; v_seq int; v_cap int; v_line int := 0;
  v_bsub int := 0; v_lsub int := 0; v_fsub int := 0; v_csub int := 0; v_main int := 0; v_bcount int := 0; v_pct numeric; v_disc int; v_fee int; v_free int; v_total int;
  v_constraint text;
begin
  perform assert_service();
  select * into s from shops where slug = p->>'shopSlug';
  if not found then perform err('shop_not_found'); end if;
  if s.mode <> 'live' then perform err('shop_is_sample'); end if;

  v_key := (p->>'idempotencyKey')::uuid;
  select * into o from orders where shop_id = s.id and idempotency_key = v_key;
  if found then return order_json(o, s) || jsonb_build_object('duplicate', true); end if;

  v_start := (p->>'slotStart')::timestamptz;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') not between 1 and 20 then perform err('bad_quantity'); end if;
  if (select count(distinct x->>'productId') <> count(*) from jsonb_array_elements(p->'items') x) then perform err('bad_quantity'); end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := (it->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then perform err('bad_quantity'); end if;
    if char_length(coalesce(it->>'note', '')) > 300 then perform err('bad_card_text'); end if;
  end loop;
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

  -- lock every product of the order in one fixed order (no deadlocks), then check stock
  perform 1 from bouquets where shop_id = s.id and id in (select x->>'productId' from jsonb_array_elements(p->'items') x)
    order by id for update;
  for it in select * from jsonb_array_elements(p->'items') loop
    select * into b from bouquets where shop_id = s.id and id = it->>'productId';
    if not found then perform err('bouquet_not_found'); end if;
    v_qty := (it->>'quantity')::int;
    if not b.in_stock or (b.stock is not null and b.stock < v_qty) then perform err('out_of_stock', b.name); end if;
    if b.kind = 'bouquet' then
      v_bsub := v_bsub + b.price * v_qty; v_bcount := v_bcount + v_qty; v_main := v_main + 1;
    elsif b.kind = 'balloon' then
      v_lsub := v_lsub + b.price * v_qty; v_main := v_main + 1;
    elsif b.kind = 'firework' then
      v_fsub := v_fsub + b.price * v_qty; v_main := v_main + 1;
    else
      v_csub := v_csub + b.price * v_qty;
    end if;
  end loop;
  -- a postcard travels with a bouquet, balloons or fireworks, never alone
  if v_main = 0 then perform err('no_bouquet'); end if;

  v_cap := coalesce((s.settings->'delivery'->>'slotCapacity')::int, 1);
  select min(g) into v_seq from generate_series(1, v_cap) g
  where not exists (select 1 from orders x where x.shop_id = s.id and x.slot_start = v_start
                    and x.slot_seq = g and x.status in ('new', 'confirmed', 'delivering'));
  if v_seq is null then perform err('slot_busy'); end if;

  -- same arithmetic as priceOrder(): quantity discount on bouquets only
  v_pct := discount_percent(s.settings, v_bcount);
  v_disc := floor(v_bsub * v_pct / 100);
  v_free := (s.settings->'delivery'->>'freeFrom')::int;
  v_fee := case when v_free is not null and v_bsub + v_lsub + v_fsub + v_csub - v_disc >= v_free then 0
                else coalesce((s.settings->'delivery'->>'fee')::int, 0) end;
  v_total := v_bsub + v_lsub + v_fsub + v_csub - v_disc + v_fee;

  update shops set order_counter = order_counter + 1 where id = s.id returning * into s;

  begin
    insert into orders (shop_id, number, token, idempotency_key, slot_start, slot_seq, bouquet_count, bouquets_subtotal,
      balloons_subtotal, fireworks_subtotal, cards_subtotal, subtotal, discount_percent, discount, delivery_fee, total,
      name, phone, contact_channel, contact_handle, address, comment)
    values (s.id, s.order_counter, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), v_key,
      v_start, v_seq, v_bcount, v_bsub, v_lsub, v_fsub, v_csub, v_bsub + v_lsub + v_fsub + v_csub, v_pct, v_disc, v_fee, v_total,
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

  for it in select * from jsonb_array_elements(p->'items') loop
    v_line := v_line + 1;
    select * into b from bouquets where shop_id = s.id and id = it->>'productId';
    v_qty := (it->>'quantity')::int;
    insert into order_items (order_id, line, product_id, kind, name, photo, quantity, unit_price, note)
    values (o.id, v_line, b.id, b.kind, b.name, b.photo, v_qty, b.price,
            case when b.kind = 'card' then left(trim(coalesce(it->>'note', '')), 300) else '' end);
    update bouquets set stock = stock - v_qty, updated_at = now() where shop_id = s.id and id = b.id and stock is not null;
  end loop;

  insert into outbox (shop_id, kind, payload) values (s.id, 'order_created', jsonb_build_object('orderId', o.id));
  return order_json(o, s) || jsonb_build_object('duplicate', false);
end $$;
