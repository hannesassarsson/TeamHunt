-- Harvest notifications and "not a duplicate" re-analysis.

create or replace function private.enqueue_harvest_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue('evaluate_event', jsonb_build_object(
    'event', 'harvest_created', 'org_id', new.org_id, 'harvest_id', new.id, 'actor_id', new.created_by));
  return null;
end $$;
create trigger harvests_enqueue after insert on public.harvests
  for each row execute function private.enqueue_harvest_event();

-- Re-analysis also releases images that were flagged as near-duplicates by mistake.
create or replace function public.reanalyze_image(p_image uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.camera_images where id = p_image;
  if v_org is null or not private.has_role(v_org, 'member') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.jobs where dedupe_key = 'analyze:' || p_image and status in ('queued', 'running')) then
    return; -- already scheduled
  end if;
  update public.camera_images
  set status = 'pending', analysis_error = null, duplicate_of = null
  where id = p_image;
  delete from public.jobs where dedupe_key = 'analyze:' || p_image;
  perform private.enqueue('analyze_image', jsonb_build_object('image_id', p_image, 'reanalyze', true), '0', 'analyze:' || p_image);
end $$;
