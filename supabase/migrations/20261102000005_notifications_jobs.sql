-- NORDHUNT notifications, background jobs, storage and integrity guards.

-- ---------------------------------------------------------------------------
-- org_id is immutable on every tenant table (prevents moving rows between orgs).
-- ---------------------------------------------------------------------------
create or replace function private.org_id_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hunting_areas','map_features','cameras','camera_images','image_tags','detections',
                           'hunt_sessions','session_participants','observations','harvests','invitations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.org_id_immutable()',
                   t || '_org_immutable', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Background jobs (Postgres-backed queue, drained by the process-jobs edge function)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id bigint generated always as identity primary key,
  type text not null check (type in ('analyze_image', 'dispatch_notification', 'evaluate_event', 'camera_health', 'daily_summary')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs (run_after) where status = 'queued';
alter table public.jobs enable row level security; -- no client policies: service role only

create or replace function private.enqueue(p_type text, p_payload jsonb, p_delay interval default '0', p_dedupe text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.jobs (type, payload, run_after, dedupe_key)
  values (p_type, p_payload, now() + p_delay, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

-- Claim up to p_limit ready jobs. Stale running jobs (worker crashed) are reclaimed after 10 minutes.
create or replace function public.claim_jobs(p_worker text, p_limit int default 10)
returns setof public.jobs language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '10 minutes')
    order by run_after
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  returning j.*;
end $$;

create or replace function public.complete_job(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set status = 'done', finished_at = now(), locked_at = null, last_error = null where id = p_id;
$$;

-- Exponential backoff: 30s, 2m, 8m, 32m, ... capped at 6h.
create or replace function public.fail_job(p_id bigint, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set
    status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    run_after = now() + least(interval '30 seconds' * power(4, attempts - 1), interval '6 hours'),
    locked_at = null,
    last_error = left(p_error, 2000),
    finished_at = case when attempts >= max_attempts then now() end
  where id = p_id;
$$;

revoke execute on function public.claim_jobs(text, int) from public, anon, authenticated;
revoke execute on function public.complete_job(bigint) from public, anon, authenticated;
revoke execute on function public.fail_job(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, int) to service_role;
grant execute on function public.complete_job(bigint) to service_role;
grant execute on function public.fail_job(bigint, text) to service_role;

-- New image -> analysis job. New observation -> event evaluation (notifications).
create or replace function private.enqueue_image_analysis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue('analyze_image', jsonb_build_object('image_id', new.id), '0', 'analyze:' || new.id);
  return null;
end $$;
create trigger camera_images_enqueue after insert on public.camera_images
  for each row when (new.status = 'pending') execute function private.enqueue_image_analysis();

create or replace function private.enqueue_observation_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue('evaluate_event', jsonb_build_object(
    'event', 'observation_created', 'org_id', new.org_id, 'observation_id', new.id, 'actor_id', new.created_by));
  return null;
end $$;
create trigger observations_enqueue after insert on public.observations
  for each row execute function private.enqueue_observation_event();

-- Allow members to request re-analysis of an image (e.g. after configuring a provider).
create or replace function public.reanalyze_image(p_image uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.camera_images where id = p_image;
  if v_org is null or not private.has_role(v_org, 'member') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.camera_images set status = 'pending', analysis_error = null where id = p_image and status <> 'duplicate';
  delete from public.jobs where dedupe_key = 'analyze:' || p_image and status in ('done', 'failed');
  perform private.enqueue('analyze_image', jsonb_build_object('image_id', p_image, 'reanalyze', true), '0', 'analyze:' || p_image);
end $$;
revoke execute on function public.reanalyze_image(uuid) from public, anon;
grant execute on function public.reanalyze_image(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create type public.notification_event as enum (
  'detection', 'species_detected', 'camera_offline', 'observation_created', 'harvest_created', 'daily_summary'
);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  event public.notification_event not null,
  species_codes text[] not null default '{}',
  camera_ids uuid[] not null default '{}',
  min_tier text not null default 'probable' check (min_tier in ('uncertain', 'probable', 'confirmed')),
  channels text[] not null default '{in_app}' check (channels <@ array['in_app', 'email', 'push'] and cardinality(channels) > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index notification_rules_org_event_idx on public.notification_rules (org_id, event) where enabled;

create table public.notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  timezone text not null default 'Europe/Stockholm',
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_id uuid references public.notification_rules (id) on delete set null,
  event public.notification_event not null,
  title text not null,
  body text not null default '',
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  provider text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.notification_rules enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.push_subscriptions enable row level security;

create policy notification_rules_own on public.notification_rules for all to authenticated
  using (user_id = auth.uid() and private.has_role(org_id, 'viewer'))
  with check (user_id = auth.uid() and private.has_role(org_id, 'viewer'));
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (exists (select 1 from public.notifications n where n.id = notification_id and n.user_id = auth.uid()));
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Clients may only toggle read state on notifications.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.mark_all_notifications_read() returns void
language sql security invoker set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private buckets, objects namespaced by org id as the first path segment.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('camera-images', 'camera-images', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('journal-photos', 'journal-photos', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create or replace function private.storage_org(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.storage_org(text) to authenticated;

create policy nordhunt_storage_select on storage.objects for select to authenticated
  using (bucket_id in ('camera-images', 'journal-photos') and private.has_role(private.storage_org(name), 'viewer'));
create policy nordhunt_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('camera-images', 'journal-photos') and private.has_role(private.storage_org(name), 'member'));
create policy nordhunt_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('camera-images', 'journal-photos') and private.has_role(private.storage_org(name), 'member'));

-- ---------------------------------------------------------------------------
-- Weather cache (service role only: coordinates of other teams must never leak)
-- ---------------------------------------------------------------------------
create table public.weather_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.weather_cache enable row level security;

-- ---------------------------------------------------------------------------
-- Scheduling (Supabase): enable pg_cron + pg_net and schedule the worker.
-- Left as documentation because it needs the project URL and service key:
--   select cron.schedule('nordhunt-worker', '* * * * *', $$
--     select net.http_post(url := '<SUPABASE_URL>/functions/v1/process-jobs',
--       headers := jsonb_build_object('Authorization', 'Bearer <WORKER_SECRET>'));
--   $$);
-- ---------------------------------------------------------------------------
