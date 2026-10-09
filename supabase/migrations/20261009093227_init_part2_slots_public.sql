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
