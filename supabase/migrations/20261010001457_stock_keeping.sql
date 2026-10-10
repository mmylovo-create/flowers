-- Stock keeping for the workshop (Telegram bot «📒 Учёт»): stems and greenery without photos,
-- separate from the products on the site. Every change is a row in stock_moves, so any day
-- can be reported: receipts, stems used for bouquets, waste, corrections.

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null check (char_length(name) between 2 and 80),
  name_key text not null,
  qty integer not null default 0 check (qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name_key)
);

create table public.stock_moves (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id),
  item_id uuid not null references public.stock_items(id),
  kind text not null check (kind in ('receipt', 'bouquet', 'waste', 'adjust')),
  delta integer not null,           -- signed change of the balance
  balance_after integer not null check (balance_after >= 0),
  note text not null default '' check (char_length(note) <= 200),
  chat_id bigint,
  created_at timestamptz not null default now()
);
create index stock_moves_shop_time on public.stock_moves (shop_id, created_at);

alter table public.stock_items enable row level security;
alter table public.stock_moves enable row level security;
revoke all on public.stock_items, public.stock_moves from anon, authenticated;

-- «Роза  Красная» and «роза красная» are the same position; ё = е.
create function public.stock_key(p_name text) returns text
language sql immutable set search_path = public as $$
  select replace(lower(regexp_replace(trim(p_name), '\s+', ' ', 'g')), 'ё', 'е')
$$;

create function public.stock_item_json(i public.stock_items) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty)
$$;

create function public.tg_stock_list(p_chat bigint, p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tg_assert_link(p_chat, p_shop);
  return (select coalesce(jsonb_agg(stock_item_json(i) order by i.name_key), '[]') from stock_items i where i.shop_id = p_shop);
end $$;

-- One batch of lines [{name, qty}] applied atomically: if any line fails, nothing changes.
--   receipt — supply arrived: +qty (unknown names become new positions)
--   bouquet — stems used for bouquets: −qty
--   waste   — thrown away (wilted, broken): −qty
--   adjust  — stocktaking: the balance becomes exactly qty
--   add     — new positions with zero balance (loading the list of goods)
create function public.tg_stock_apply(p_chat bigint, p_shop uuid, p_kind text, p_lines jsonb, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ln jsonb; v_name text; v_key text; v_qty int; v_delta int; i stock_items; v_created boolean;
  out jsonb := '[]';
begin
  perform tg_assert_link(p_chat, p_shop);
  if p_kind not in ('receipt', 'bouquet', 'waste', 'adjust', 'add') then perform err('bad_stock_line', p_kind); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then perform err('bad_stock_line', 'lines'); end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_name := regexp_replace(trim(coalesce(ln->>'name', '')), '\s+', ' ', 'g');
    v_key := stock_key(v_name);
    if char_length(v_name) not between 2 and 80 then perform err('bad_stock_line', coalesce(nullif(v_name, ''), '?')); end if;
    v_qty := coalesce((ln->>'qty')::int, 0);
    if p_kind in ('receipt', 'bouquet', 'waste') and (v_qty < 1 or v_qty > 100000) then perform err('bad_stock_line', v_name); end if;
    if p_kind = 'adjust' and (v_qty < 0 or v_qty > 100000) then perform err('bad_stock_line', v_name); end if;

    v_created := false;
    select * into i from stock_items where shop_id = p_shop and name_key = v_key for update;
    if not found then
      if p_kind not in ('receipt', 'add') then perform err('stock_item_not_found', v_name); end if;
      insert into stock_items (shop_id, name, name_key) values (p_shop, v_name, v_key) returning * into i;
      v_created := true;
    end if;

    v_delta := case p_kind when 'receipt' then v_qty when 'adjust' then v_qty - i.qty when 'add' then 0 else -v_qty end;
    if i.qty + v_delta < 0 then perform err('stock_not_enough', i.name || ': на складе ' || i.qty || ' шт.'); end if;
    if v_delta <> 0 or p_kind = 'adjust' then
      update stock_items set qty = qty + v_delta, updated_at = now() where id = i.id returning * into i;
      insert into stock_moves (shop_id, item_id, kind, delta, balance_after, note, chat_id)
      values (p_shop, i.id, case when p_kind = 'add' then 'adjust' else p_kind end, v_delta, i.qty, left(coalesce(p_note, ''), 200), p_chat);
    end if;
    out := out || jsonb_build_object('name', i.name, 'qty', v_qty, 'delta', v_delta, 'balance', i.qty, 'created', v_created);
  end loop;
  return jsonb_build_object('kind', p_kind, 'lines', out);
end $$;

-- Everything that happened on one day (shop time zone; today when p_day is null).
create function public.tg_stock_report(p_chat bigint, p_shop uuid, p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_day date;
begin
  perform tg_assert_link(p_chat, p_shop);
  select coalesce(settings->>'timezone', 'Europe/Moscow') into v_tz from shops where id = p_shop;
  v_day := coalesce(p_day, (now() at time zone v_tz)::date);
  return jsonb_build_object(
    'day', v_day,
    'today', (now() at time zone v_tz)::date,
    'moves', (select coalesce(jsonb_agg(jsonb_build_object(
                'time', to_char(m.created_at at time zone v_tz, 'HH24:MI'), 'kind', m.kind, 'name', i.name,
                'delta', m.delta, 'balance', m.balance_after, 'note', m.note) order by m.created_at, m.id), '[]')
              from stock_moves m join stock_items i on i.id = m.item_id
              where m.shop_id = p_shop and (m.created_at at time zone v_tz)::date = v_day),
    'totals', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                select m.kind as k, sum(abs(m.delta))::int as n from stock_moves m
                where m.shop_id = p_shop and (m.created_at at time zone v_tz)::date = v_day group by m.kind) t),
    'stock', (select jsonb_build_object('items', count(*) filter (where qty > 0), 'qty', coalesce(sum(qty), 0)::int)
              from stock_items where shop_id = p_shop)
  );
end $$;

revoke all on function public.stock_key(text), public.stock_item_json(public.stock_items),
  public.tg_stock_list(bigint, uuid), public.tg_stock_apply(bigint, uuid, text, jsonb, text),
  public.tg_stock_report(bigint, uuid, date) from public, anon, authenticated;
grant execute on function public.tg_stock_list(bigint, uuid), public.tg_stock_apply(bigint, uuid, text, jsonb, text),
  public.tg_stock_report(bigint, uuid, date) to service_role;

-- A zeroed starter list for shops that already exist; more positions come with the first supply.
insert into public.stock_items (shop_id, name, name_key)
select s.id, n, public.stock_key(n)
from public.shops s
cross join unnest(array[
  'Роза красная', 'Роза белая', 'Роза розовая', 'Роза кустовая', 'Пион', 'Тюльпан', 'Хризантема кустовая',
  'Гвоздика', 'Альстромерия', 'Эустома', 'Гипсофила', 'Ранункулюс', 'Ромашка', 'Гортензия', 'Ирис',
  'Эвкалипт', 'Фисташка', 'Рускус'
]) as n
on conflict (shop_id, name_key) do nothing;
