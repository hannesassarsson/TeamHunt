-- Image search pagination/filters and re-analysis.
begin;
\ir _helpers.sql
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'), ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select (public.create_organization('Team A')).id as org;
grant all on t to authenticated;
insert into public.camera_images (org_id, storage_path, sha256, captured_at)
select (select org from t), (select org from t)::text || '/u/' || g || '.jpg', lpad(to_hex(g), 64, '0'), timestamptz '2026-10-01 00:00Z' + make_interval(hours => g)
from generate_series(1, 10) g;
select pg_temp.as_admin();
update public.camera_images set status = 'duplicate' where storage_path like '%/10.jpg';
update public.camera_images set status = 'analyzed' where storage_path like '%/9.jpg';
insert into public.detections (org_id, image_id, species_code, confidence, source, provider)
select org_id, id, 'lynx', 0.9, 'ai', 't' from public.camera_images where storage_path like '%/9.jpg';
insert into public.detections (org_id, image_id, species_code, confidence, source, provider)
select org_id, id, 'lynx', 0.4, 'ai', 't' from public.camera_images where storage_path like '%/8.jpg';
insert into public.image_tags (image_id, org_id, tag) select id, org_id, 'favorit' from public.camera_images where storage_path like '%/3.jpg';

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare last record;
begin
  assert (select count(*) from public.search_images((select org from t))) = 9, 'duplicates hidden by default';
  assert (select count(*) from public.search_images((select org from t), p_include_duplicates => true)) = 10;
  assert (select count(*) from public.search_images((select org from t), p_species => 'lynx')) = 2;
  assert (select count(*) from public.search_images((select org from t), p_species => 'lynx', p_min_tier => 'probable')) = 1;
  assert (select count(*) from public.search_images((select org from t), p_tag => 'favorit')) = 1;
  assert (select count(*) from public.search_images((select org from t), p_status => 'duplicate')) = 1;
  select * into last from public.search_images((select org from t), p_limit => 4) offset 3 limit 1;
  assert (select count(*) from public.search_images((select org from t), p_before_at => last.captured_at, p_before_id => last.id)) = 5, 'keyset pagination';
end $$;

-- Re-analysis of a duplicate releases it and enqueues a single job
select public.reanalyze_image((select id from public.camera_images where storage_path like '%/10.jpg'));
select public.reanalyze_image((select id from public.camera_images where storage_path like '%/10.jpg'));
select pg_temp.as_admin();
do $$ begin
  assert (select status from public.camera_images where storage_path like '%/10.jpg') = 'pending';
  assert (select count(*) from public.jobs where dedupe_key = 'analyze:' || (select id from public.camera_images where storage_path like '%/10.jpg')) = 1;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.reanalyze_image((select id from public.camera_images limit 1))$$, 'Not allowed');
do $$ begin assert (select count(*) from public.search_images((select org from t))) = 0, 'search respects RLS'; end $$;
rollback;
