-- NORDHUNT trail cameras, image library and AI detections.

-- ---------------------------------------------------------------------------
-- Species catalog (reference data, readable by all signed-in users)
-- ---------------------------------------------------------------------------
create table public.species (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  name_en text not null,
  name_sv text not null,
  name_no text,
  name_fi text,
  scientific_name text,
  category text not null check (category in ('ungulate', 'large_carnivore', 'small_carnivore', 'small_game', 'bird', 'other', 'non_animal')),
  sort_order int not null default 100
);

insert into public.species (code, name_en, name_sv, name_no, name_fi, scientific_name, category, sort_order) values
  ('moose', 'Moose', 'Älg', 'Elg', 'Hirvi', 'Alces alces', 'ungulate', 1),
  ('roe_deer', 'Roe deer', 'Rådjur', 'Rådyr', 'Metsäkauris', 'Capreolus capreolus', 'ungulate', 2),
  ('red_deer', 'Red deer', 'Kronhjort', 'Hjort', 'Saksanhirvi', 'Cervus elaphus', 'ungulate', 3),
  ('fallow_deer', 'Fallow deer', 'Dovhjort', 'Dåhjort', 'Kuusipeura', 'Dama dama', 'ungulate', 4),
  ('white_tailed_deer', 'White-tailed deer', 'Vitsvanshjort', 'Hvithalehjort', 'Valkohäntäpeura', 'Odocoileus virginianus', 'ungulate', 5),
  ('wild_boar', 'Wild boar', 'Vildsvin', 'Villsvin', 'Villisika', 'Sus scrofa', 'ungulate', 6),
  ('reindeer', 'Reindeer', 'Ren', 'Rein', 'Poro', 'Rangifer tarandus', 'ungulate', 7),
  ('mouflon', 'Mouflon', 'Mufflon', 'Mufflon', 'Mufloni', 'Ovis gmelini musimon', 'ungulate', 8),
  ('brown_bear', 'Brown bear', 'Brunbjörn', 'Brunbjørn', 'Karhu', 'Ursus arctos', 'large_carnivore', 10),
  ('wolf', 'Wolf', 'Varg', 'Ulv', 'Susi', 'Canis lupus', 'large_carnivore', 11),
  ('lynx', 'Eurasian lynx', 'Lodjur', 'Gaupe', 'Ilves', 'Lynx lynx', 'large_carnivore', 12),
  ('wolverine', 'Wolverine', 'Järv', 'Jerv', 'Ahma', 'Gulo gulo', 'large_carnivore', 13),
  ('red_fox', 'Red fox', 'Rödräv', 'Rødrev', 'Kettu', 'Vulpes vulpes', 'small_carnivore', 20),
  ('badger', 'European badger', 'Grävling', 'Grevling', 'Mäyrä', 'Meles meles', 'small_carnivore', 21),
  ('pine_marten', 'Pine marten', 'Mård', 'Mår', 'Näätä', 'Martes martes', 'small_carnivore', 22),
  ('raccoon_dog', 'Raccoon dog', 'Mårdhund', 'Mårhund', 'Supikoira', 'Nyctereutes procyonoides', 'small_carnivore', 23),
  ('otter', 'Eurasian otter', 'Utter', 'Oter', 'Saukko', 'Lutra lutra', 'small_carnivore', 24),
  ('mink', 'American mink', 'Mink', 'Mink', 'Minkki', 'Neogale vison', 'small_carnivore', 25),
  ('stoat', 'Stoat', 'Hermelin', 'Røyskatt', 'Kärppä', 'Mustela erminea', 'small_carnivore', 26),
  ('mountain_hare', 'Mountain hare', 'Skogshare', 'Hare', 'Metsäjänis', 'Lepus timidus', 'small_game', 30),
  ('brown_hare', 'European hare', 'Fälthare', 'Sørhare', 'Rusakko', 'Lepus europaeus', 'small_game', 31),
  ('beaver', 'Eurasian beaver', 'Bäver', 'Bever', 'Majava', 'Castor fiber', 'small_game', 32),
  ('red_squirrel', 'Red squirrel', 'Ekorre', 'Ekorn', 'Orava', 'Sciurus vulgaris', 'small_game', 33),
  ('capercaillie', 'Western capercaillie', 'Tjäder', 'Storfugl', 'Metso', 'Tetrao urogallus', 'bird', 40),
  ('black_grouse', 'Black grouse', 'Orre', 'Orrfugl', 'Teeri', 'Lyrurus tetrix', 'bird', 41),
  ('hazel_grouse', 'Hazel grouse', 'Järpe', 'Jerpe', 'Pyy', 'Tetrastes bonasia', 'bird', 42),
  ('willow_ptarmigan', 'Willow ptarmigan', 'Dalripa', 'Lirype', 'Riekko', 'Lagopus lagopus', 'bird', 43),
  ('rock_ptarmigan', 'Rock ptarmigan', 'Fjällripa', 'Fjellrype', 'Kiiruna', 'Lagopus muta', 'bird', 44),
  ('pheasant', 'Common pheasant', 'Fasan', 'Fasan', 'Fasaani', 'Phasianus colchicus', 'bird', 45),
  ('mallard', 'Mallard', 'Gräsand', 'Stokkand', 'Sinisorsa', 'Anas platyrhynchos', 'bird', 46),
  ('canada_goose', 'Canada goose', 'Kanadagås', 'Kanadagås', 'Kanadanhanhi', 'Branta canadensis', 'bird', 47),
  ('corvid', 'Crow / raven / magpie', 'Kråkfågel', 'Kråkefugl', 'Varislintu', 'Corvidae', 'bird', 48),
  ('bird_other', 'Other bird', 'Annan fågel', 'Annen fugl', 'Muu lintu', null, 'bird', 49),
  ('domestic_dog', 'Dog', 'Hund', 'Hund', 'Koira', 'Canis familiaris', 'other', 60),
  ('domestic_cat', 'Cat', 'Katt', 'Katt', 'Kissa', 'Felis catus', 'other', 61),
  ('livestock', 'Livestock', 'Tamdjur', 'Husdyr', 'Kotieläin', null, 'other', 62),
  ('animal_unknown', 'Unidentified animal', 'Oidentifierat djur', 'Uidentifisert dyr', 'Tunnistamaton eläin', null, 'other', 90),
  ('human', 'Person', 'Människa', 'Menneske', 'Ihminen', 'Homo sapiens', 'non_animal', 95),
  ('vehicle', 'Vehicle', 'Fordon', 'Kjøretøy', 'Ajoneuvo', null, 'non_animal', 96);

alter table public.species enable row level security;
create policy species_select on public.species for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Cameras
-- ---------------------------------------------------------------------------
create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  area_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 80),
  model text check (char_length(model) <= 80),
  serial text check (char_length(serial) <= 80),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  heading_deg smallint check (heading_deg between 0 and 359),
  notes text check (char_length(notes) <= 2000),
  active boolean not null default true,
  -- A camera with no image for this long is considered offline.
  offline_after_hours int not null default 48 check (offline_after_hours between 1 and 2160),
  last_seen_at timestamptz,
  last_battery_pct smallint check (last_battery_pct between 0 and 100),
  offline_notified_at timestamptz,
  -- Prefix of the current ingest token, for display only (the hash lives in camera_ingest_tokens).
  ingest_token_prefix text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (area_id, org_id) references public.hunting_areas (id, org_id) on delete set null (area_id),
  check ((lat is null) = (lon is null))
);
create index cameras_org_idx on public.cameras (org_id);
-- Ingest tokens for direct uploads from cellular cameras / mail bridges. Only the hash is
-- stored, in a table with no client policies (service role only).
create table public.camera_ingest_tokens (
  camera_id uuid primary key references public.cameras (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.camera_ingest_tokens enable row level security;

create trigger cameras_touch before update on public.cameras
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Images
-- ---------------------------------------------------------------------------
create type public.image_status as enum ('pending', 'processing', 'analyzed', 'needs_review', 'failed', 'duplicate');

create table public.camera_images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  camera_id uuid,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  phash text check (phash ~ '^[0-9a-f]{16}$'),
  width int check (width > 0),
  height int check (height > 0),
  bytes int check (bytes > 0),
  captured_at timestamptz,
  -- 'exif' when read from image metadata, 'upload' when the file had none and upload time was used.
  captured_at_source text check (captured_at_source in ('exif', 'camera', 'upload', 'manual')),
  source text not null default 'upload' check (source in ('upload', 'ingest')),
  status public.image_status not null default 'pending',
  duplicate_of uuid references public.camera_images (id) on delete set null,
  has_animals boolean,
  analysis_provider text,
  analysis_model text,
  analysis_error text,
  analyzed_at timestamptz,
  -- Weather at capture time: { kind: 'observed'|'forecast', source, temperature_c, wind_speed_ms, ... }
  weather jsonb,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (org_id, sha256),
  unique (id, org_id),
  foreign key (camera_id, org_id) references public.cameras (id, org_id) on delete set null (camera_id)
);
create index camera_images_org_captured_idx on public.camera_images (org_id, captured_at desc);
create index camera_images_camera_captured_idx on public.camera_images (camera_id, captured_at desc);
create index camera_images_status_idx on public.camera_images (org_id, status);
create index camera_images_phash_idx on public.camera_images (org_id, camera_id, phash) where phash is not null;

-- Storage path must sit under the org folder so storage RLS and row RLS agree.
alter table public.camera_images add constraint camera_images_path_in_org
  check (split_part(storage_path, '/', 1) = org_id::text);

create table public.image_tags (
  image_id uuid not null,
  org_id uuid not null,
  tag text not null check (tag ~ '^[\w\-åäöæøÅÄÖÆØ ]{1,32}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (image_id, tag),
  foreign key (image_id, org_id) references public.camera_images (id, org_id) on delete cascade
);
create index image_tags_org_tag_idx on public.image_tags (org_id, tag);

-- ---------------------------------------------------------------------------
-- Detections
-- ---------------------------------------------------------------------------
create type public.detection_review as enum ('unreviewed', 'confirmed', 'corrected', 'rejected');

create table public.detections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  image_id uuid not null,
  species_code text not null references public.species (code),
  -- Number of individuals visible in the image, when countable. NULL = not determined.
  count int check (count between 1 and 500),
  confidence numeric(4,3) check (confidence between 0 and 1),
  -- Normalised bounding box [x, y, width, height] in 0..1 image coordinates.
  bbox jsonb check (bbox is null or (jsonb_typeof(bbox) = 'array' and jsonb_array_length(bbox) = 4)),
  source text not null check (source in ('ai', 'manual')),
  provider text,
  model text,
  -- The species the AI originally proposed, kept when a reviewer corrects it.
  ai_species_code text references public.species (code),
  review public.detection_review not null default 'unreviewed',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (image_id, org_id) references public.camera_images (id, org_id) on delete cascade,
  check (source = 'manual' or confidence is not null)
);
create index detections_image_idx on public.detections (image_id);
create index detections_org_species_idx on public.detections (org_id, species_code);
create index detections_org_review_idx on public.detections (org_id, review);

-- Classification tier. "confirmed" requires human verification (or a manual entry);
-- AI output alone is at most "probable".
create or replace function public.detection_tier(p_source text, p_review public.detection_review, p_confidence numeric, p_threshold numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_review = 'rejected' then 'rejected'
    when p_source = 'manual' or p_review in ('confirmed', 'corrected') then 'confirmed'
    when p_confidence >= p_threshold then 'probable'
    else 'uncertain'
  end;
$$;

create view public.detections_view with (security_invoker = true) as
  select d.*,
         public.detection_tier(d.source, d.review, d.confidence, o.probable_threshold) as tier,
         i.camera_id, i.captured_at
  from public.detections d
  join public.camera_images i on i.id = d.image_id
  join public.organizations o on o.id = d.org_id;

-- Reviewing a detection stamps reviewer + time, keeps the original AI species when corrected.
create or replace function private.detection_review_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and (new.source is distinct from old.source
       or new.provider is distinct from old.provider or new.model is distinct from old.model
       or new.confidence is distinct from old.confidence or new.image_id <> old.image_id
       or new.org_id <> old.org_id) then
      raise exception 'AI output fields are read-only' using errcode = '42501';
    end if;
    if new.species_code <> old.species_code and old.source = 'ai' then
      new.ai_species_code := coalesce(old.ai_species_code, old.species_code);
      if new.review in ('unreviewed', 'confirmed') then
        new.review := 'corrected';
      end if;
    end if;
    if new.review is distinct from old.review or new.species_code <> old.species_code or new.count is distinct from old.count then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  elsif new.source = 'manual' then
    new.review := 'confirmed';
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;
  return new;
end $$;

create trigger detections_review_stamp before insert or update on public.detections
  for each row execute function private.detection_review_stamp();

-- After a human review changes detections, re-derive image status and has_animals.
create or replace function private.refresh_image_after_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_image uuid := coalesce(new.image_id, old.image_id);
begin
  update public.camera_images i
  set has_animals = exists (
        select 1 from public.detections d join public.species s on s.code = d.species_code
        where d.image_id = v_image and d.review <> 'rejected' and s.category <> 'non_animal'),
      status = case
        when i.status = 'needs_review' and not exists (
          select 1 from public.detections d where d.image_id = v_image and d.review = 'unreviewed'
        ) then 'analyzed'::public.image_status
        else i.status end
  where i.id = v_image and i.status in ('analyzed', 'needs_review');
  return null;
end $$;

create trigger detections_refresh_image after insert or update or delete on public.detections
  for each row execute function private.refresh_image_after_review();

-- Keep camera last_seen_at current.
create or replace function private.camera_last_seen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.camera_id is not null then
    update public.cameras
    set last_seen_at = greatest(coalesce(last_seen_at, '-infinity'), coalesce(new.captured_at, new.uploaded_at)),
        offline_notified_at = null
    where id = new.camera_id;
  end if;
  return null;
end $$;

create trigger camera_images_last_seen after insert on public.camera_images
  for each row execute function private.camera_last_seen();

create trigger audit_cameras after insert or update or delete on public.cameras
  for each row execute function private.audit();
create trigger audit_detections after update or delete on public.detections
  for each row execute function private.audit();

-- Rotate a camera's ingest token; returns the raw token once. Admins only.
create or replace function public.rotate_camera_ingest_token(p_camera uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_token text := 'nhc_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select org_id into v_org from public.cameras where id = p_camera;
  if v_org is null or not private.has_role(v_org, 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.camera_ingest_tokens (camera_id, org_id, token_hash)
  values (p_camera, v_org, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (camera_id) do update set token_hash = excluded.token_hash, created_at = now();
  update public.cameras set ingest_token_prefix = left(v_token, 10) where id = p_camera;
  return v_token;
end $$;
revoke execute on function public.rotate_camera_ingest_token(uuid) from public, anon;
grant execute on function public.rotate_camera_ingest_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.cameras enable row level security;
alter table public.camera_images enable row level security;
alter table public.image_tags enable row level security;
alter table public.detections enable row level security;

create policy cameras_select on public.cameras for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy cameras_insert on public.cameras for insert to authenticated
  with check (private.has_role(org_id, 'admin'));
create policy cameras_update on public.cameras for update to authenticated
  using (private.has_role(org_id, 'admin')) with check (private.has_role(org_id, 'admin'));
create policy cameras_delete on public.cameras for delete to authenticated
  using (private.has_role(org_id, 'admin'));

create policy camera_images_select on public.camera_images for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy camera_images_insert on public.camera_images for insert to authenticated
  with check (private.has_role(org_id, 'member') and uploaded_by = auth.uid() and status = 'pending' and source = 'upload');
create policy camera_images_update on public.camera_images for update to authenticated
  using (private.has_role(org_id, 'member')) with check (private.has_role(org_id, 'member'));
create policy camera_images_delete on public.camera_images for delete to authenticated
  using (private.has_role(org_id, 'admin') or (uploaded_by = auth.uid() and private.has_role(org_id, 'member')));

-- Members may only edit descriptive fields on images; analysis fields belong to the worker.
revoke update on public.camera_images from authenticated;
grant update (camera_id, captured_at, captured_at_source) on public.camera_images to authenticated;

create policy image_tags_select on public.image_tags for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy image_tags_insert on public.image_tags for insert to authenticated
  with check (private.has_role(org_id, 'member'));
create policy image_tags_delete on public.image_tags for delete to authenticated
  using (private.has_role(org_id, 'member'));

create policy detections_select on public.detections for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy detections_insert on public.detections for insert to authenticated
  with check (private.has_role(org_id, 'member') and source = 'manual');
create policy detections_update on public.detections for update to authenticated
  using (private.has_role(org_id, 'member')) with check (private.has_role(org_id, 'member'));
create policy detections_delete on public.detections for delete to authenticated
  using (private.has_role(org_id, 'member') and source = 'manual');
