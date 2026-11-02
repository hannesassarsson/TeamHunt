-- NORDHUNT spatial model.
-- Geometries are stored as GeoJSON (RFC 7946, WGS84 lon/lat) in jsonb, validated on write,
-- with a derived bounding box for indexed viewport queries. This keeps the model portable
-- (the frontend, GeoJSON import/export and edge functions all speak GeoJSON). If PostGIS is
-- enabled later, a generated geometry column can be added without changing the API.

create or replace function private.geojson_positions(g jsonb) returns table (lon double precision, lat double precision)
language sql immutable set search_path = '' as $$
  select (p ->> 0)::double precision, (p ->> 1)::double precision
  from jsonb_path_query(g, 'strict $.coordinates.**') as p
  where jsonb_typeof(p) = 'array' and jsonb_typeof(p -> 0) = 'number';
$$;

create or replace function private.validate_geometry(g jsonb, allowed text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_type text := g ->> 'type';
  v_n int;
  v_bad int;
begin
  if g is null or jsonb_typeof(g) <> 'object' or v_type is null or not (v_type = any (allowed)) then
    raise exception 'Invalid geometry type %, expected one of %', coalesce(v_type, 'null'), allowed using errcode = '22023';
  end if;
  if jsonb_typeof(g -> 'coordinates') <> 'array' then
    raise exception 'Geometry coordinates must be an array' using errcode = '22023';
  end if;
  select count(*), count(*) filter (where lon not between -180 and 180 or lat not between -90 and 90)
  into v_n, v_bad from private.geojson_positions(g);
  if v_n = 0 then
    raise exception 'Geometry has no coordinates' using errcode = '22023';
  end if;
  if v_bad > 0 then
    raise exception 'Coordinates must be WGS84 longitude/latitude' using errcode = '22023';
  end if;
  if v_n > 20000 then
    raise exception 'Geometry too large (% vertices, max 20000)', v_n using errcode = '22023';
  end if;
  if v_type = 'LineString' and v_n < 2 then
    raise exception 'A line needs at least two points' using errcode = '22023';
  end if;
  if v_type in ('Polygon', 'MultiPolygon') and v_n < 4 then
    raise exception 'A polygon needs at least three distinct points' using errcode = '22023';
  end if;
end $$;

-- Trigger: validate geometry and maintain bbox columns.
create or replace function private.spatial_bbox() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_allowed text[] := tg_argv::text[];
begin
  perform private.validate_geometry(new.geometry, v_allowed);
  select min(lon), min(lat), max(lon), max(lat)
  into new.min_lon, new.min_lat, new.max_lon, new.max_lat
  from private.geojson_positions(new.geometry);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Hunting areas: user-drawn areas the team operates in. These are NOT property
-- boundaries and do not imply any hunting rights; the UI states this explicitly.
-- ---------------------------------------------------------------------------
create table public.hunting_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 2000),
  color text not null default '#c08a3e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  geometry jsonb not null,
  area_m2 double precision check (area_m2 >= 0),
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index hunting_areas_org_idx on public.hunting_areas (org_id);
create trigger hunting_areas_bbox before insert or update of geometry on public.hunting_areas
  for each row execute function private.spatial_bbox('Polygon', 'MultiPolygon');
create trigger hunting_areas_touch before update on public.hunting_areas
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Map features: stands, feeding stations, paths, markers, drawn polygons.
-- Cameras and observations live in their own tables and are rendered as layers.
-- ---------------------------------------------------------------------------
create type public.map_feature_kind as enum (
  'stand', 'feeding_station', 'salt_lick', 'marker', 'path', 'zone', 'parking', 'drag_route'
);

create table public.map_features (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  area_id uuid,
  kind public.map_feature_kind not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  notes text check (char_length(notes) <= 2000),
  geometry jsonb not null,
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object' and pg_column_size(properties) < 8192),
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (area_id, org_id) references public.hunting_areas (id, org_id) on delete set null (area_id),
  constraint map_features_kind_geometry check (
    case
      when kind in ('path', 'drag_route') then geometry ->> 'type' in ('LineString', 'MultiLineString')
      when kind = 'zone' then geometry ->> 'type' in ('Polygon', 'MultiPolygon')
      else geometry ->> 'type' = 'Point'
    end
  )
);
create index map_features_org_kind_idx on public.map_features (org_id, kind);
create index map_features_bbox_idx on public.map_features (org_id, min_lon, max_lon, min_lat, max_lat);
create trigger map_features_bbox before insert or update of geometry on public.map_features
  for each row execute function private.spatial_bbox('Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon');
create trigger map_features_touch before update on public.map_features
  for each row execute function private.touch_updated_at();

create trigger audit_hunting_areas after insert or update or delete on public.hunting_areas
  for each row execute function private.audit();
create trigger audit_map_features after insert or update or delete on public.map_features
  for each row execute function private.audit();

alter table public.hunting_areas enable row level security;
alter table public.map_features enable row level security;

create policy hunting_areas_select on public.hunting_areas for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy hunting_areas_insert on public.hunting_areas for insert to authenticated
  with check (private.has_role(org_id, 'admin') and created_by = auth.uid());
create policy hunting_areas_update on public.hunting_areas for update to authenticated
  using (private.has_role(org_id, 'admin')) with check (private.has_role(org_id, 'admin'));
create policy hunting_areas_delete on public.hunting_areas for delete to authenticated
  using (private.has_role(org_id, 'admin'));

create policy map_features_select on public.map_features for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy map_features_insert on public.map_features for insert to authenticated
  with check (private.has_role(org_id, 'member') and created_by = auth.uid());
create policy map_features_update on public.map_features for update to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')))
  with check (private.has_role(org_id, 'member'));
create policy map_features_delete on public.map_features for delete to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')));
