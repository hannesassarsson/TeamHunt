-- Hardening: authorship immutability, detection column grants, storage delete, invite rate limit.
begin;
\ir _helpers.sql
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select (public.create_organization('Team A')).id as org;
grant all on t to authenticated;
select pg_temp.as_admin();
insert into public.memberships values ((select org from t), '00000000-0000-0000-0000-00000000000b', 'member');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.observations (org_id, species_code) values ((select org from t), 'moose');
select pg_temp.expect_error($$update public.observations set created_by = '00000000-0000-0000-0000-00000000000a'$$, 'created_by cannot be changed');
insert into public.camera_images (org_id, storage_path, sha256) values ((select org from t), (select org from t)::text || '/x.jpg', repeat('b', 64));
insert into public.detections (org_id, image_id, species_code, source)
select org_id, id, 'moose', 'manual' from public.camera_images;
select pg_temp.expect_error($$update public.detections set reviewed_by = '00000000-0000-0000-0000-00000000000a'$$, 'permission denied');
update public.detections set notes = 'big one';

-- Storage: Bob uploads; Alice (owner/admin) can delete anything; Bob cannot delete Alice's objects.
insert into storage.objects (bucket_id, name) values ('journal-photos', (select org from t)::text || '/bob.jpg');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into storage.objects (bucket_id, name) values ('journal-photos', (select org from t)::text || '/alice.jpg');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from storage.objects where name like '%alice.jpg';
delete from storage.objects where name like '%bob.jpg';
do $$ begin assert (select count(*) from storage.objects) = 1, 'member deletes only own objects'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from storage.objects;
do $$ begin assert (select count(*) from storage.objects) = 0, 'admin deletes any object'; end $$;

-- Invitation rate limit
do $$ begin
  for i in 1..30 loop perform public.create_invitation((select org from t), 'p' || i || '@example.com', 'member'); end loop;
end $$;
select pg_temp.expect_error($$select public.create_invitation((select org from t), 'one-more@example.com', 'member')$$, 'Too many invitations');
rollback;
