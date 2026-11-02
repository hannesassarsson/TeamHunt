-- NORDHUNT wildlife analytics. All functions are SECURITY INVOKER, so RLS applies.
--
-- Counting model: a "camera event" is one image in which a species was detected (any
-- non-rejected detection). Events are NOT individual animals: the same animal can trigger
-- many images, and NORDHUNT never claims to identify individuals.

create or replace function public.tier_rank(p_tier text) returns int
language sql immutable set search_path = '' as $$
  select case p_tier when 'confirmed' then 3 when 'probable' then 2 when 'uncertain' then 1 else 0 end;
$$;

create view public.camera_events with (security_invoker = true) as
  select i.id as image_id, i.org_id, i.camera_id,
         coalesce(i.captured_at, i.uploaded_at) as at,
         d.species_code,
         max(public.tier_rank(public.detection_tier(d.source, d.review, d.confidence, o.probable_threshold))) as tier_rank,
         max(d.count) as max_count,
         i.weather
  from public.camera_images i
  join public.detections d on d.image_id = i.id and d.review <> 'rejected'
  join public.species s on s.code = d.species_code and s.category <> 'non_animal'
  join public.organizations o on o.id = i.org_id
  where i.status <> 'duplicate'
  group by i.id, i.org_id, i.camera_id, i.captured_at, i.uploaded_at, d.species_code, i.weather;

create or replace function public.analytics_activity_by_hour(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_species text[] default null, p_min_tier text default 'uncertain'
) returns table (hour int, camera_events bigint, observations bigint)
language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone from public.organizations where id = p_org),
  ce as (
    select extract(hour from e.at at time zone (select timezone from tz))::int as h, count(*) as n
    from public.camera_events e
    where e.org_id = p_org and e.at >= p_from and e.at < p_to
      and (p_species is null or e.species_code = any (p_species))
      and e.tier_rank >= public.tier_rank(p_min_tier)
    group by 1
  ),
  ob as (
    select extract(hour from o.observed_at at time zone (select timezone from tz))::int as h, count(*) as n
    from public.observations o
    where o.org_id = p_org and o.observed_at >= p_from and o.observed_at < p_to
      and (p_species is null or o.species_code = any (p_species))
    group by 1
  )
  select g.h, coalesce(ce.n, 0), coalesce(ob.n, 0)
  from generate_series(0, 23) g(h)
  left join ce on ce.h = g.h
  left join ob on ob.h = g.h
  order by g.h;
$$;

create or replace function public.analytics_species_summary(
  p_org uuid, p_from timestamptz, p_to timestamptz
) returns table (species_code text, camera_events bigint, confirmed_events bigint, probable_events bigint,
                 uncertain_events bigint, observations bigint, harvests bigint, last_seen timestamptz)
language sql stable security invoker set search_path = '' as $$
  with ce as (
    select e.species_code, count(*) n,
           count(*) filter (where e.tier_rank = 3) c3,
           count(*) filter (where e.tier_rank = 2) c2,
           count(*) filter (where e.tier_rank = 1) c1,
           max(e.at) last_at
    from public.camera_events e
    where e.org_id = p_org and e.at >= p_from and e.at < p_to
    group by 1
  ),
  ob as (
    select o.species_code, count(*) n, max(o.observed_at) last_at from public.observations o
    where o.org_id = p_org and o.observed_at >= p_from and o.observed_at < p_to group by 1
  ),
  hv as (
    select h.species_code, count(*) n, max(h.harvested_at) last_at from public.harvests h
    where h.org_id = p_org and h.harvested_at >= p_from and h.harvested_at < p_to group by 1
  )
  select s, coalesce(ce.n, 0), coalesce(ce.c3, 0), coalesce(ce.c2, 0), coalesce(ce.c1, 0),
         coalesce(ob.n, 0), coalesce(hv.n, 0), greatest(ce.last_at, ob.last_at, hv.last_at)
  from (select species_code s from ce union select species_code from ob union select species_code from hv) k
  left join ce on ce.species_code = k.s
  left join ob on ob.species_code = k.s
  left join hv on hv.species_code = k.s
  order by coalesce(ce.n, 0) + coalesce(ob.n, 0) desc;
$$;

create or replace function public.analytics_daily(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_species text[] default null
) returns table (day date, images bigint, camera_events bigint, observations bigint)
language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone from public.organizations where id = p_org),
  days as (
    select generate_series((p_from at time zone (select timezone from tz))::date,
                           ((p_to - interval '1 second') at time zone (select timezone from tz))::date,
                           interval '1 day')::date d
  ),
  im as (
    select (coalesce(i.captured_at, i.uploaded_at) at time zone (select timezone from tz))::date d, count(*) n
    from public.camera_images i
    where i.org_id = p_org and coalesce(i.captured_at, i.uploaded_at) >= p_from and coalesce(i.captured_at, i.uploaded_at) < p_to
      and i.status <> 'duplicate'
    group by 1
  ),
  ce as (
    select (e.at at time zone (select timezone from tz))::date d, count(*) n from public.camera_events e
    where e.org_id = p_org and e.at >= p_from and e.at < p_to and (p_species is null or e.species_code = any (p_species))
    group by 1
  ),
  ob as (
    select (o.observed_at at time zone (select timezone from tz))::date d, count(*) n from public.observations o
    where o.org_id = p_org and o.observed_at >= p_from and o.observed_at < p_to and (p_species is null or o.species_code = any (p_species))
    group by 1
  )
  select days.d, coalesce(im.n, 0), coalesce(ce.n, 0), coalesce(ob.n, 0)
  from days left join im on im.d = days.d left join ce on ce.d = days.d left join ob on ob.d = days.d
  order by days.d;
$$;

create or replace function public.analytics_monthly(p_org uuid, p_years int default 3, p_species text[] default null)
returns table (year int, month int, camera_events bigint, observations bigint, harvests bigint)
language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone from public.organizations where id = p_org),
  since as (select date_trunc('year', now()) - make_interval(years => greatest(p_years, 1) - 1) t),
  ce as (
    select extract(year from e.at at time zone (select timezone from tz))::int y,
           extract(month from e.at at time zone (select timezone from tz))::int m, count(*) n
    from public.camera_events e
    where e.org_id = p_org and e.at >= (select t from since) and (p_species is null or e.species_code = any (p_species))
    group by 1, 2
  ),
  ob as (
    select extract(year from o.observed_at at time zone (select timezone from tz))::int y,
           extract(month from o.observed_at at time zone (select timezone from tz))::int m, count(*) n
    from public.observations o
    where o.org_id = p_org and o.observed_at >= (select t from since) and (p_species is null or o.species_code = any (p_species))
    group by 1, 2
  ),
  hv as (
    select extract(year from h.harvested_at at time zone (select timezone from tz))::int y,
           extract(month from h.harvested_at at time zone (select timezone from tz))::int m, count(*) n
    from public.harvests h
    where h.org_id = p_org and h.harvested_at >= (select t from since) and (p_species is null or h.species_code = any (p_species))
    group by 1, 2
  ),
  grid as (
    select y, m from generate_series(extract(year from (select t from since))::int, extract(year from now())::int) y,
                     generate_series(1, 12) m
  )
  select grid.y, grid.m, coalesce(ce.n, 0), coalesce(ob.n, 0), coalesce(hv.n, 0)
  from grid
  left join ce on ce.y = grid.y and ce.m = grid.m
  left join ob on ob.y = grid.y and ob.m = grid.m
  left join hv on hv.y = grid.y and hv.m = grid.m
  order by grid.y, grid.m;
$$;

create or replace function public.analytics_camera_activity(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (camera_id uuid, images bigint, animal_images bigint, last_image_at timestamptz, top_species text)
language sql stable security invoker set search_path = '' as $$
  select c.id,
         count(i.id) filter (where i.status <> 'duplicate'),
         count(i.id) filter (where i.has_animals and i.status <> 'duplicate'),
         max(coalesce(i.captured_at, i.uploaded_at)),
         (select e.species_code from public.camera_events e
           where e.camera_id = c.id and e.at >= p_from and e.at < p_to
           group by e.species_code order by count(*) desc limit 1)
  from public.cameras c
  left join public.camera_images i on i.camera_id = c.id
    and coalesce(i.captured_at, i.uploaded_at) >= p_from and coalesce(i.captured_at, i.uploaded_at) < p_to
  where c.org_id = p_org
  group by c.id
  order by 2 desc;
$$;

-- Weather correlation: for images that have a weather snapshot, how often an animal of the
-- selected species was present, bucketed by temperature, wind and precipitation.
create or replace function public.analytics_weather(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_species text[] default null
) returns table (dimension text, bucket text, sort_key int, images bigint, animal_images bigint)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select i.id, i.weather,
           exists (select 1 from public.camera_events e where e.image_id = i.id
                   and (p_species is null or e.species_code = any (p_species))) as hit
    from public.camera_images i
    where i.org_id = p_org and i.weather is not null and i.status <> 'duplicate'
      and coalesce(i.captured_at, i.uploaded_at) >= p_from and coalesce(i.captured_at, i.uploaded_at) < p_to
  ),
  t as (
    select 'temperature'::text dim,
           (floor((weather ->> 'temperature_c')::numeric / 5) * 5)::int k, hit
    from base where weather ? 'temperature_c' and jsonb_typeof(weather -> 'temperature_c') = 'number'
  ),
  w as (
    select 'wind'::text dim,
           case when (weather ->> 'wind_speed_ms')::numeric < 2 then 0
                when (weather ->> 'wind_speed_ms')::numeric < 5 then 1
                when (weather ->> 'wind_speed_ms')::numeric < 8 then 2 else 3 end k, hit
    from base where jsonb_typeof(weather -> 'wind_speed_ms') = 'number'
  ),
  p as (
    select 'precipitation'::text dim,
           case when (weather ->> 'precipitation_mm')::numeric = 0 then 0
                when (weather ->> 'precipitation_mm')::numeric < 1 then 1 else 2 end k, hit
    from base where jsonb_typeof(weather -> 'precipitation_mm') = 'number'
  )
  select dim,
         case dim
           when 'temperature' then k || '…' || (k + 5) || ' °C'
           when 'wind' then (array['Calm < 2 m/s', 'Light 2–5 m/s', 'Moderate 5–8 m/s', 'Strong ≥ 8 m/s'])[k + 1]
           else (array['Dry', 'Light < 1 mm', 'Wet ≥ 1 mm'])[k + 1]
         end,
         k, count(*), count(*) filter (where hit)
  from (select * from t union all select * from w union all select * from p) x
  group by dim, k
  order by dim, k;
$$;

grant execute on function public.analytics_activity_by_hour(uuid, timestamptz, timestamptz, text[], text) to authenticated;
grant execute on function public.analytics_species_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_daily(uuid, timestamptz, timestamptz, text[]) to authenticated;
grant execute on function public.analytics_monthly(uuid, int, text[]) to authenticated;
grant execute on function public.analytics_camera_activity(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_weather(uuid, timestamptz, timestamptz, text[]) to authenticated;
