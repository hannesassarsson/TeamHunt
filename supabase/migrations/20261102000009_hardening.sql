-- Security hardening found in review.

-- 1. Authorship columns are immutable for API users (prevents re-attributing rows).
create or replace function private.created_by_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hunting_areas','map_features','cameras','hunt_sessions','observations','harvests','detections'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.created_by_immutable()',
                   t || '_created_by_immutable', t);
  end loop;
end $$;

-- 2. Reviewers may only change review fields on detections; reviewer identity is stamped by trigger.
revoke update on public.detections from authenticated;
grant update (species_code, count, review, notes) on public.detections to authenticated;

-- 3. Storage deletes: admins, or the user who uploaded the object.
drop policy if exists nordhunt_storage_delete on storage.objects;
create policy nordhunt_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('camera-images', 'journal-photos')
    and (private.has_role(private.storage_org(name), 'admin')
         or (owner_id = auth.uid()::text and private.has_role(private.storage_org(name), 'member')))
  );

-- 4. Invitation rate limit (protects the email channel from abuse).
create or replace function private.invitation_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.invitations where org_id = new.org_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many invitations in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.invitations where org_id = new.org_id and accepted_at is null and revoked_at is null and expires_at > now()) >= 100 then
    raise exception 'Too many open invitations. Revoke some first.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger invitations_rate_limit before insert on public.invitations
  for each row execute function private.invitation_rate_limit();

-- 5. Realtime feed for in-app notifications (RLS still applies to subscribers).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- 6. Housekeeping: finished jobs are pruned by the worker via this function.
create or replace function public.prune_jobs(p_keep interval default '14 days') returns int
language sql security definer set search_path = '' as $$
  with d as (delete from public.jobs where status in ('done', 'failed') and finished_at < now() - p_keep returning 1)
  select count(*)::int from d;
$$;
revoke execute on function public.prune_jobs(interval) from public, anon, authenticated;
grant execute on function public.prune_jobs(interval) to service_role;
