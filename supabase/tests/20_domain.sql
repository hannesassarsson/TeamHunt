-- Spatial validation, cameras, images, detections/tiers, journal, jobs and analytics.
begin;
\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select (public.create_organization('Team A')).id as org;
grant all on t to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
create temp table tc as select (public.create_organization('Team C')).id as org;
grant all on tc to authenticated;

-- Bob joins team A as viewer (via service role for brevity)
select pg_temp.as_admin();
insert into public.memberships values ((select org from t), '00000000-0000-0000-0000-00000000000b', 'viewer');

-- ---------------------------------------------------------------- spatial
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.hunting_areas (org_id, name, geometry) values ((select org from t), 'Norra skiftet',
  '{"type":"Polygon","coordinates":[[[15.0,60.0],[15.1,60.0],[15.1,60.1],[15.0,60.1],[15.0,60.0]]]}');
do $$ begin
  assert (select min_lon from public.hunting_areas) = 15.0 and (select max_lat from public.hunting_areas) = 60.1, 'bbox computed';
end $$;
select pg_temp.expect_error($$insert into public.hunting_areas (org_id, name, geometry) values ((select org from t), 'bad',
  '{"type":"Polygon","coordinates":[[[200,60],[15.1,60],[15.1,60.1],[200,60]]]}')$$, 'WGS84');
select pg_temp.expect_error($$insert into public.hunting_areas (org_id, name, geometry) values ((select org from t), 'pt',
  '{"type":"Point","coordinates":[15,60]}')$$, 'Invalid geometry type');
select pg_temp.expect_error($$insert into public.map_features (org_id, kind, name, geometry) values ((select org from t), 'stand', 'Torn 1',
  '{"type":"LineString","coordinates":[[15,60],[15.1,60.1]]}')$$, 'map_features_kind_geometry');
insert into public.map_features (org_id, kind, name, geometry) values
  ((select org from t), 'stand', 'Torn 1', '{"type":"Point","coordinates":[15.05,60.05]}'),
  ((select org from t), 'path', 'Stig', '{"type":"LineString","coordinates":[[15,60],[15.05,60.05]]}');

-- Cross-org reference: Carol cannot attach a feature in her org to Alice's area
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin assert (select count(*) from public.hunting_areas) = 0, 'areas isolated'; end $$;
select pg_temp.as_admin();
create temp table t_area as select id from public.hunting_areas limit 1;
grant all on t_area to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$insert into public.map_features (org_id, area_id, kind, name, geometry) values ((select org from tc), (select id from t_area), 'stand', 'x',
  '{"type":"Point","coordinates":[15,60]}')$$, 'foreign key');

-- Viewer cannot write
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into public.map_features (org_id, kind, name, geometry) values ((select org from t), 'stand', 'x',
  '{"type":"Point","coordinates":[15,60]}')$$, 'row-level security');
do $$ begin assert (select count(*) from public.map_features) = 2, 'viewer can read features'; end $$;

-- ---------------------------------------------------------------- cameras & images
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.cameras (org_id, name, lat, lon) values ((select org from t), 'Kamera Myren', 60.05, 15.05);
create temp table t_cam as select id from public.cameras;
grant all on t_cam to authenticated;
select public.rotate_camera_ingest_token((select id from t_cam)) like 'nhc_%' as token_ok \gset
do $$ begin
  assert (select ingest_token_prefix from public.cameras) like 'nhc_%';
  assert (select count(*) from public.camera_ingest_tokens) = 0, 'token hashes invisible to clients';
end $$;

insert into public.camera_images (org_id, camera_id, storage_path, sha256, captured_at)
select (select org from t), (select id from t_cam), (select org from t)::text || '/cam/img' || g || '.jpg',
       lpad(to_hex(g), 64, '0'), timestamptz '2026-10-01 05:00:00+02' + make_interval(hours => g)
from generate_series(1, 6) g;

-- Image path must be inside the org folder
select pg_temp.expect_error($$insert into public.camera_images (org_id, storage_path, sha256) values ((select org from t), 'other/x.jpg', repeat('a', 64))$$, 'camera_images_path_in_org');
-- Exact duplicates rejected by sha256 uniqueness
select pg_temp.expect_error($$insert into public.camera_images (org_id, storage_path, sha256) values ((select org from t), (select org from t)::text || '/d.jpg', lpad(to_hex(1), 64, '0'))$$, 'duplicate key');
-- Members cannot forge analysis results
select pg_temp.expect_error($$update public.camera_images set status = 'analyzed', has_animals = true$$, 'permission denied');

select pg_temp.as_admin();
do $$ begin
  assert (select count(*) from public.jobs where type = 'analyze_image') = 6, 'analysis jobs enqueued';
  assert (select last_seen_at from public.cameras) = timestamptz '2026-10-01 11:00:00+02', 'camera last_seen updated';
end $$;

-- Worker claims and completes jobs, with backoff on failure
create temp table claimed as select * from public.claim_jobs('w1', 2);
do $$ begin
  assert (select count(*) from claimed) = 2;
  assert (select count(*) from public.claim_jobs('w2', 10)) = 4, 'skip locked: second worker gets the rest';
end $$;
select public.fail_job((select min(id) from claimed), 'boom');
select public.complete_job((select max(id) from claimed));
do $$ begin
  assert (select status from public.jobs where id = (select min(id) from claimed)) = 'queued';
  assert (select run_after from public.jobs where id = (select min(id) from claimed)) > now(), 'backoff applied';
  assert (select status from public.jobs where id = (select max(id) from claimed)) = 'done';
end $$;

-- Worker writes AI detections (service role)
update public.camera_images set status = 'needs_review', analysis_provider = 'test', weather =
  jsonb_build_object('kind', 'observed', 'temperature_c', 3.5, 'wind_speed_ms', 1.2, 'precipitation_mm', 0);
insert into public.detections (org_id, image_id, species_code, count, confidence, source, provider)
select org_id, id, 'moose', 1, 0.93, 'ai', 'test' from public.camera_images where storage_path like '%img1.jpg' or storage_path like '%img2.jpg';
insert into public.detections (org_id, image_id, species_code, count, confidence, source, provider)
select org_id, id, 'roe_deer', 2, 0.55, 'ai', 'test' from public.camera_images where storage_path like '%img3.jpg';
insert into public.detections (org_id, image_id, species_code, confidence, source, provider)
select org_id, id, 'human', 0.99, 'ai', 'test' from public.camera_images where storage_path like '%img4.jpg';

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select tier from public.detections_view where species_code = 'moose' limit 1) = 'probable', 'high AI confidence = probable';
  assert (select tier from public.detections_view where species_code = 'roe_deer') = 'uncertain', 'low AI confidence = uncertain';
  assert (select count(*) from public.detections_view where tier = 'confirmed') = 0, 'AI alone never confirms';
end $$;

-- Reviewer corrects roe deer -> fallow deer: original AI species kept, tier becomes confirmed
update public.detections set species_code = 'fallow_deer' where species_code = 'roe_deer';
do $$ begin
  assert (select review from public.detections where species_code = 'fallow_deer') = 'corrected';
  assert (select ai_species_code from public.detections where species_code = 'fallow_deer') = 'roe_deer';
  assert (select reviewed_by from public.detections where species_code = 'fallow_deer') = '00000000-0000-0000-0000-00000000000a';
  assert (select tier from public.detections_view where species_code = 'fallow_deer') = 'confirmed';
end $$;
-- Members cannot alter AI confidence
select pg_temp.expect_error($$update public.detections set confidence = 1 where species_code = 'moose'$$, 'read-only');
-- Members cannot delete AI detections, only reject them
delete from public.detections where species_code = 'moose';
do $$ begin assert (select count(*) from public.detections where species_code = 'moose') = 2; end $$;
update public.detections set review = 'confirmed' where species_code = 'moose';
update public.detections set review = 'rejected' where species_code = 'human';

-- Images with all detections reviewed leave the review queue; has_animals derived
select pg_temp.as_admin();
do $$ begin
  assert (select count(*) from public.camera_images where status = 'needs_review' and storage_path ~ 'img[1-4]') = 0, 'reviewed images resolved';
  assert (select has_animals from public.camera_images where storage_path like '%img4.jpg') = false, 'human-only image has no animals';
  assert (select has_animals from public.camera_images where storage_path like '%img1.jpg') = true;
end $$;

-- ---------------------------------------------------------------- journal
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.hunt_sessions (org_id, title, started_at, ended_at) values
  ((select org from t), 'Morgonpass', '2026-10-01 05:30+02', '2026-10-01 09:00+02');
select pg_temp.expect_error($$insert into public.hunt_sessions (org_id, title, started_at, ended_at) values ((select org from t), 'x', now(), now() - interval '1 hour')$$, 'check constraint');
select pg_temp.expect_error($$insert into public.session_participants (session_id, org_id, user_id) select id, org_id, '00000000-0000-0000-0000-00000000000c' from public.hunt_sessions$$, 'not a member');
insert into public.session_participants (session_id, org_id, user_id, role) select id, org_id, '00000000-0000-0000-0000-00000000000b', 'hunter' from public.hunt_sessions;
insert into public.observations (org_id, session_id, species_code, count, observed_at, lat, lon)
select org_id, id, 'moose', 2, '2026-10-01 06:15+02', 60.06, 15.04 from public.hunt_sessions;
insert into public.harvests (org_id, session_id, species_code, sex, age_class, weight_kg, harvested_at)
select org_id, id, 'moose', 'male', 'adult', 210, '2026-10-01 07:40+02' from public.hunt_sessions;
select pg_temp.expect_error($$insert into public.observations (org_id, species_code, photo_paths) values ((select org from t), 'moose', array['someone-else/x.jpg'])$$, 'outside organization');

-- Viewer cannot add observations; Carol cannot see Alice's
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into public.observations (org_id, species_code) values ((select org from t), 'moose')$$, 'row-level security');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.observations) = 0;
  assert (select count(*) from public.camera_images) = 0;
  assert (select count(*) from public.detections_view) = 0;
  assert (select count(*) from public.camera_events) = 0;
  assert (select count(*) from public.analytics_species_summary((select org from t), '2026-01-01', '2027-01-01')) = 0, 'analytics respects RLS';
end $$;
-- Carol cannot move her rows into Alice's org
select pg_temp.expect_error($$insert into public.observations (org_id, species_code) values ((select org from t), 'moose')$$, 'row-level security');

select pg_temp.as_admin();
do $$ begin assert (select count(*) from public.jobs where type = 'evaluate_event') = 1, 'observation event enqueued'; end $$;

-- ---------------------------------------------------------------- analytics
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare r record;
begin
  select * into r from public.analytics_species_summary((select org from t), '2026-01-01', '2027-01-01') where species_code = 'moose';
  assert r.camera_events = 2 and r.confirmed_events = 2 and r.observations = 1 and r.harvests = 1, format('moose summary %s', r);
  assert not exists (select 1 from public.analytics_species_summary((select org from t), '2026-01-01', '2027-01-01') where species_code = 'human'), 'non-animals excluded';
  assert (select sum(camera_events) from public.analytics_activity_by_hour((select org from t), '2026-01-01', '2027-01-01')) = 3;
  assert (select count(*) from public.analytics_activity_by_hour((select org from t), '2026-01-01', '2027-01-01')) = 24;
  -- img1 captured 06:00 Stockholm time
  assert (select camera_events from public.analytics_activity_by_hour((select org from t), '2026-01-01', '2027-01-01', array['moose']) where hour = 6) = 1, 'hour bucketed in org timezone';
  assert (select camera_events from public.analytics_activity_by_hour((select org from t), '2026-01-01', '2027-01-01', null, 'confirmed') where hour = 8) = 1;
  assert (select count(*) from public.analytics_daily((select org from t), '2026-10-01 00:00+02', '2026-10-08 00:00+02')) = 7;
  assert (select images from public.analytics_daily((select org from t), '2026-10-01 00:00+02', '2026-10-08 00:00+02') where day = '2026-10-01') = 6;
  assert (select animal_images from public.analytics_camera_activity((select org from t), '2026-01-01', '2027-01-01')) = 3;
  assert (select top_species from public.analytics_camera_activity((select org from t), '2026-01-01', '2027-01-01')) = 'moose';
  assert (select images from public.analytics_weather((select org from t), '2026-01-01', '2027-01-01') where dimension = 'temperature') = 6;
  assert (select animal_images from public.analytics_weather((select org from t), '2026-01-01', '2027-01-01') where dimension = 'wind') = 3;
  assert exists (select 1 from public.analytics_monthly((select org from t), 1) where year = 2026 and month = 10 and harvests = 1);
end $$;

-- ---------------------------------------------------------------- notifications
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.notification_rules (org_id, name, event, species_codes, channels)
values ((select org from t), 'Älg på kamera', 'species_detected', array['moose'], array['in_app', 'push']);
select pg_temp.expect_error($$insert into public.notification_rules (org_id, name, event, channels) values ((select org from t), 'x', 'detection', array['sms'])$$, 'check constraint');
select pg_temp.as_admin();
insert into public.notifications (org_id, user_id, event, title) values ((select org from t), '00000000-0000-0000-0000-00000000000b', 'detection', 'Moose');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$update public.notifications set title = 'x'$$, 'permission denied');
select public.mark_all_notifications_read();
do $$ begin assert (select read_at from public.notifications) is not null; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.notifications) = 0, 'notifications are private';
  assert (select count(*) from public.notification_rules) = 0, 'rules are private';
end $$;

-- ---------------------------------------------------------------- org_id immutability
select pg_temp.as_admin();
insert into public.memberships values ((select org from tc), '00000000-0000-0000-0000-00000000000a', 'admin');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.map_features set org_id = (select org from tc)$$, 'cannot be changed');

-- ---------------------------------------------------------------- storage policies
select pg_temp.as_admin();
insert into storage.objects (bucket_id, name) values ('camera-images', (select org from t)::text || '/cam/img1.jpg');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
delete from public.memberships where org_id = (select org from tc) and user_id = '00000000-0000-0000-0000-00000000000a';
do $$ begin assert (select count(*) from storage.objects) = 0, 'storage isolated'; end $$;
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('camera-images', (select org from t)::text || '/evil.jpg')$$, 'row-level security');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from storage.objects) = 1, 'viewer reads org storage'; end $$;
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('camera-images', (select org from t)::text || '/x.jpg')$$, 'row-level security');

rollback;
