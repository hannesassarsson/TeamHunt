-- Thumbnails/GPS columns are worker-only; deleting an image queues storage cleanup.
begin;
\ir _helpers.sql
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select (public.create_organization('Team A')).id as org;
grant all on t to authenticated;
insert into public.camera_images (org_id, storage_path, sha256) values ((select org from t), (select org from t)::text || '/a.jpg', repeat('c', 64));
select pg_temp.expect_error($$update public.camera_images set thumb_path = (select org from t)::text || '/thumbs/x.jpg'$$, 'permission denied');
select pg_temp.expect_error($$update public.camera_images set gps_lat = 1, gps_lon = 1$$, 'permission denied');
select pg_temp.as_admin();
select pg_temp.expect_error($$update public.camera_images set thumb_path = 'other-org/x.jpg'$$, 'camera_images_thumb_in_org');
update public.camera_images set thumb_path = org_id::text || '/thumbs/a.jpg', gps_lat = 62.4, gps_lon = 17.3;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.camera_images;
select pg_temp.as_admin();
do $$
declare j record;
begin
  select * into j from public.jobs where type = 'storage_cleanup';
  assert found, 'cleanup job queued';
  assert j.payload->>'bucket' = 'camera-images';
  assert jsonb_array_length(j.payload->'paths') = 2, 'original and thumbnail queued';
end $$;
rollback;
