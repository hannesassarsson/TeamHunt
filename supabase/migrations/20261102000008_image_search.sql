-- Image library search with keyset pagination. SECURITY INVOKER: RLS applies.
create or replace function public.search_images(
  p_org uuid,
  p_camera uuid default null,
  p_species text default null,
  p_min_tier text default null,
  p_status public.image_status default null,
  p_tag text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_include_duplicates boolean default false,
  p_animals_only boolean default false,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 48
) returns setof public.camera_images
language sql stable security invoker set search_path = '' as $$
  select i.* from public.camera_images i
  where i.org_id = p_org
    and (p_camera is null or i.camera_id = p_camera)
    and (p_status is null or i.status = p_status)
    and (p_include_duplicates or p_status = 'duplicate' or i.status <> 'duplicate')
    and (not p_animals_only or i.has_animals)
    and (p_from is null or coalesce(i.captured_at, i.uploaded_at) >= p_from)
    and (p_to is null or coalesce(i.captured_at, i.uploaded_at) < p_to)
    and (p_tag is null or exists (select 1 from public.image_tags t where t.image_id = i.id and t.tag = p_tag))
    and (p_species is null and p_min_tier is null or exists (
      select 1 from public.camera_events e
      where e.image_id = i.id
        and (p_species is null or e.species_code = p_species)
        and (p_min_tier is null or e.tier_rank >= public.tier_rank(p_min_tier))
    ))
    and (p_before_at is null or (coalesce(i.captured_at, i.uploaded_at), i.id) < (p_before_at, p_before_id))
  order by coalesce(i.captured_at, i.uploaded_at) desc, i.id desc
  limit least(greatest(p_limit, 1), 200);
$$;
grant execute on function public.search_images(uuid, uuid, text, text, public.image_status, text, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, int) to authenticated;

create index if not exists camera_images_org_effective_time_idx
  on public.camera_images (org_id, (coalesce(captured_at, uploaded_at)) desc, id desc);
