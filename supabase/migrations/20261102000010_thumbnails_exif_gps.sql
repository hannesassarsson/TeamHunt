-- Thumbnails and EXIF GPS for camera images (additive, non-destructive).
alter table public.camera_images
  add column thumb_path text,
  add column gps_lat double precision check (gps_lat between -90 and 90),
  add column gps_lon double precision check (gps_lon between -180 and 180),
  add constraint camera_images_thumb_in_org check (thumb_path is null or split_part(thumb_path, '/', 1) = org_id::text),
  add constraint camera_images_gps_pair check ((gps_lat is null) = (gps_lon is null));
-- Clients cannot write these columns: camera_images UPDATE is column-granted (camera_id, captured_at, captured_at_source).

-- Storage cleanup: deleting an image row queues removal of its original and thumbnail files,
-- so no orphaned objects remain even if the client's own storage delete fails or lacks permission.
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('analyze_image', 'dispatch_notification', 'evaluate_event', 'camera_health', 'daily_summary', 'storage_cleanup'));

create or replace function private.enqueue_storage_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue('storage_cleanup', jsonb_build_object(
    'bucket', 'camera-images',
    'paths', to_jsonb(array_remove(array[old.storage_path, old.thumb_path], null))));
  return null;
end $$;
create trigger camera_images_storage_cleanup after delete on public.camera_images
  for each row execute function private.enqueue_storage_cleanup();
