-- NORDHUNT core: profiles, organizations (hunting teams), memberships, invitations, audit log.
-- Every org-scoped table is protected by Row Level Security using private.has_role().

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('viewer', 'member', 'admin', 'owner');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Organizations / hunting teams
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  timezone text not null default 'Europe/Stockholm',
  -- AI detections at or above this confidence are "probable"; below are "uncertain".
  -- Only human verification makes a detection "confirmed".
  probable_threshold numeric(4,3) not null default 0.800 check (probable_threshold > 0 and probable_threshold <= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Role check used by every RLS policy. SECURITY DEFINER avoids recursive RLS on memberships.
create or replace function private.has_role(p_org uuid, p_min public.org_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role >= p_min
  );
$$;

create or replace function private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid() or exists (
    select 1 from public.memberships a
    join public.memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

grant execute on function private.has_role(uuid, public.org_role) to authenticated, service_role;
grant execute on function private.shares_org_with(uuid) to authenticated, service_role;

-- Never allow an organization to lose its last owner.
create or replace function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(old.org_id, new.org_id);
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Allow cascading deletes when the organization itself is being removed.
    if not exists (select 1 from public.organizations where id = v_org) then
      return coalesce(new, old);
    end if;
    if not exists (
      select 1 from public.memberships
      where org_id = v_org and role = 'owner' and user_id <> old.user_id
    ) then
      raise exception 'An organization must keep at least one owner' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger memberships_protect_last_owner before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

-- Admins may manage members, but only owners may grant or revoke the owner role.
create or replace function private.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return coalesce(new, old); -- service role / migrations
  end if;
  if tg_op = 'UPDATE' and (new.role = 'owner' or old.role = 'owner')
     and not private.has_role(old.org_id, 'owner') then
    raise exception 'Only owners can change owner roles' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.user_id <> old.user_id) then
    raise exception 'Membership identity is immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and old.role = 'owner' and old.user_id <> auth.uid()
     and not private.has_role(old.org_id, 'owner') then
    raise exception 'Only owners can remove owners' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger memberships_guard before update or delete on public.memberships
  for each row execute function private.guard_membership_change();

-- ---------------------------------------------------------------------------
-- Invitations (token is only ever stored hashed)
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.org_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index invitations_org_idx on public.invitations (org_id);
create unique index invitations_open_unique on public.invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id text,
  changes jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_events_org_at_idx on public.audit_events (org_id, at desc);

-- Generic audit trigger. Records changed column names (not values) for updates to avoid
-- copying sensitive coordinates into the log; records a compact label on insert/delete.
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_changes jsonb := '{}'::jsonb;
  v_org uuid := (v_row ->> 'org_id')::uuid;
  v_key text;
begin
  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  end if;
  if v_org is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_org) then
    return old; -- organization is being deleted; its audit log goes with it
  end if;
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, true);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    v_changes := jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(v_changes) k));
  else
    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'label', coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'species_code', v_row ->> 'email', v_row ->> 'role')
    ));
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity, entity_id, changes)
  values (v_org, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_changes);
  return coalesce(new, old);
end $$;

create trigger audit_organizations after update on public.organizations
  for each row execute function private.audit();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit();
create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_timezone text default 'Europe/Stockholm')
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = auth.uid() and role = 'owner') >= 20 then
    raise exception 'Organization limit reached' using errcode = 'P0001';
  end if;
  insert into public.organizations (name, timezone, created_by)
  values (trim(p_name), coalesce(nullif(p_timezone, ''), 'Europe/Stockholm'), auth.uid())
  returning * into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  return v_org;
end $$;

-- Creates an invitation and returns the raw token exactly once. Admins only.
create or replace function public.create_invitation(p_org uuid, p_email text, p_role public.org_role default 'member')
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if not private.has_role(p_org, 'admin') then
    raise exception 'Only admins can invite members' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Invitations cannot grant the owner role' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = p_org and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'That person is already a member' using errcode = '23505';
  end if;
  -- Replace any open invitation for the same address.
  update public.invitations set revoked_at = now()
  where org_id = p_org and lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.invitations (org_id, email, role, token_hash, invited_by)
  values (p_org, lower(trim(p_email)), p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return query select v_id, v_token;
end $$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'Invitation not found or revoked' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation already used' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Invitation has expired' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role)
  values (v_inv.org_id, auth.uid(), v_inv.role)
  on conflict (org_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.org_id;
end $$;

-- Member list with emails, visible only to members of that org.
create or replace function public.org_members(p_org uuid)
returns table (user_id uuid, role public.org_role, display_name text, email text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, p.display_name, u.email::text, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.org_id = p_org and private.has_role(p_org, 'viewer')
  order by m.role desc, p.display_name;
$$;

revoke execute on function public.create_organization(text, text) from public, anon;
revoke execute on function public.create_invitation(uuid, text, public.org_role) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.org_members(uuid) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.create_invitation(uuid, text, public.org_role) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.org_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (private.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
  using (private.has_role(id, 'viewer'));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, 'admin')) with check (private.has_role(id, 'admin'));
create policy organizations_delete on public.organizations for delete to authenticated
  using (private.has_role(id, 'owner'));

create policy memberships_select on public.memberships for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy memberships_update on public.memberships for update to authenticated
  using (private.has_role(org_id, 'admin')) with check (private.has_role(org_id, 'admin'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (private.has_role(org_id, 'admin') or user_id = auth.uid());

create policy invitations_select on public.invitations for select to authenticated
  using (private.has_role(org_id, 'admin'));
create policy invitations_update on public.invitations for update to authenticated
  using (private.has_role(org_id, 'admin')) with check (private.has_role(org_id, 'admin'));

create policy audit_select on public.audit_events for select to authenticated
  using (private.has_role(org_id, 'admin'));
