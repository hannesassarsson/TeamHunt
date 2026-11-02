-- NORDHUNT hunting journal: sessions, participants, observations, harvests.

create table public.hunt_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  area_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 120),
  hunt_type text check (hunt_type in ('stand', 'stalk', 'drive', 'dog', 'calling', 'tracking', 'other')),
  started_at timestamptz not null,
  ended_at timestamptz,
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  notes text check (char_length(notes) <= 10000),
  -- { kind: 'observed'|'forecast', source, temperature_c, wind_speed_ms, wind_dir_deg, ... }
  weather jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (area_id, org_id) references public.hunting_areas (id, org_id) on delete set null (area_id),
  check (ended_at is null or ended_at >= started_at),
  check ((lat is null) = (lon is null))
);
create index hunt_sessions_org_started_idx on public.hunt_sessions (org_id, started_at desc);
create trigger hunt_sessions_touch before update on public.hunt_sessions
  for each row execute function private.touch_updated_at();

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  org_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  guest_name text check (char_length(guest_name) <= 80),
  role text check (role in ('leader', 'hunter', 'dog_handler', 'driver', 'guest')),
  created_at timestamptz not null default now(),
  foreign key (session_id, org_id) references public.hunt_sessions (id, org_id) on delete cascade,
  check (user_id is not null or guest_name is not null)
);
create unique index session_participants_user_unique on public.session_participants (session_id, user_id) where user_id is not null;
create index session_participants_session_idx on public.session_participants (session_id);

-- A registered participant must be a member of the session's organization.
create or replace function private.participant_is_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.memberships where org_id = new.org_id and user_id = new.user_id
  ) then
    raise exception 'Participant is not a member of this team' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger session_participants_member before insert or update on public.session_participants
  for each row execute function private.participant_is_member();

create type public.observation_kind as enum ('sighting', 'track', 'scat', 'sound', 'bed', 'browsing', 'carcass', 'other');

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid,
  area_id uuid,
  species_code text not null references public.species (code),
  kind public.observation_kind not null default 'sighting',
  count int check (count between 1 and 1000),
  observed_at timestamptz not null default now(),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  notes text check (char_length(notes) <= 4000),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 10),
  weather jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, org_id) references public.hunt_sessions (id, org_id) on delete set null (session_id),
  foreign key (area_id, org_id) references public.hunting_areas (id, org_id) on delete set null (area_id),
  check ((lat is null) = (lon is null))
);
create index observations_org_observed_idx on public.observations (org_id, observed_at desc);
create index observations_org_species_idx on public.observations (org_id, species_code);
create index observations_session_idx on public.observations (session_id) where session_id is not null;
create trigger observations_touch before update on public.observations
  for each row execute function private.touch_updated_at();

create table public.harvests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid,
  species_code text not null references public.species (code),
  sex text not null default 'unknown' check (sex in ('male', 'female', 'unknown')),
  age_class text not null default 'unknown' check (age_class in ('juvenile', 'yearling', 'adult', 'unknown')),
  -- Entered by the hunter (not inferred by AI). Dressed/field weight.
  weight_kg numeric(6,1) check (weight_kg > 0 and weight_kg < 1500),
  antler_points smallint check (antler_points between 0 and 40),
  harvested_at timestamptz not null default now(),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  shooter_user_id uuid references auth.users (id) on delete set null,
  shooter_name text check (char_length(shooter_name) <= 80),
  notes text check (char_length(notes) <= 4000),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 10),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, org_id) references public.hunt_sessions (id, org_id) on delete set null (session_id),
  check ((lat is null) = (lon is null))
);
create index harvests_org_harvested_idx on public.harvests (org_id, harvested_at desc);
create index harvests_session_idx on public.harvests (session_id) where session_id is not null;
create trigger harvests_touch before update on public.harvests
  for each row execute function private.touch_updated_at();

-- Photos referenced from journal rows must live under the org's folder.
create or replace function private.check_photo_paths() returns trigger
language plpgsql set search_path = '' as $$
declare
  p text;
begin
  foreach p in array new.photo_paths loop
    if split_part(p, '/', 1) <> new.org_id::text then
      raise exception 'Photo path outside organization' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
create trigger observations_photos before insert or update of photo_paths on public.observations
  for each row execute function private.check_photo_paths();
create trigger harvests_photos before insert or update of photo_paths on public.harvests
  for each row execute function private.check_photo_paths();

create trigger audit_hunt_sessions after insert or update or delete on public.hunt_sessions
  for each row execute function private.audit();
create trigger audit_observations after insert or update or delete on public.observations
  for each row execute function private.audit();
create trigger audit_harvests after insert or update or delete on public.harvests
  for each row execute function private.audit();

alter table public.hunt_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.observations enable row level security;
alter table public.harvests enable row level security;

-- Members can create; authors and admins can edit/delete.
create policy hunt_sessions_select on public.hunt_sessions for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy hunt_sessions_insert on public.hunt_sessions for insert to authenticated
  with check (private.has_role(org_id, 'member') and created_by = auth.uid());
create policy hunt_sessions_update on public.hunt_sessions for update to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')))
  with check (private.has_role(org_id, 'member'));
create policy hunt_sessions_delete on public.hunt_sessions for delete to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')));

create policy session_participants_select on public.session_participants for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy session_participants_write on public.session_participants for all to authenticated
  using (private.has_role(org_id, 'member')) with check (private.has_role(org_id, 'member'));

create policy observations_select on public.observations for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy observations_insert on public.observations for insert to authenticated
  with check (private.has_role(org_id, 'member') and created_by = auth.uid());
create policy observations_update on public.observations for update to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')))
  with check (private.has_role(org_id, 'member'));
create policy observations_delete on public.observations for delete to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')));

create policy harvests_select on public.harvests for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy harvests_insert on public.harvests for insert to authenticated
  with check (private.has_role(org_id, 'member') and created_by = auth.uid());
create policy harvests_update on public.harvests for update to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')))
  with check (private.has_role(org_id, 'member'));
create policy harvests_delete on public.harvests for delete to authenticated
  using (private.has_role(org_id, 'admin') or (created_by = auth.uid() and private.has_role(org_id, 'member')));
