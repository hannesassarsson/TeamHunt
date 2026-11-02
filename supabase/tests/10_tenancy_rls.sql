-- Tenancy, roles, invitations and cross-organization isolation.
begin;

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com');

-- Profiles are created by trigger
do $$ begin
  assert (select count(*) from public.profiles) = 4, 'profiles auto-created';
  assert (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'alice';
end $$;

-- Alice creates team A, Carol creates team C
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t_org as select (public.create_organization('Älgjaktlaget Norr')).id;
grant all on t_org to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
create temp table t_org_c as select (public.create_organization('Carol Team')).id;
grant all on t_org_c to authenticated;

-- Isolation: Carol sees only her own org
do $$ begin
  assert (select count(*) from public.organizations) = 1, 'carol sees one org';
  assert (select id from public.organizations) = (select id from t_org_c);
end $$;

-- Alice invites Bob as member
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t_inv as select * from public.create_invitation((select id from t_org), 'Bob@Example.com', 'member');
grant all on t_inv to authenticated;
do $$ begin
  assert (select count(*) from public.invitations) = 1;
  assert (select email from public.invitations) = 'bob@example.com', 'email normalised';
  assert (select token_hash from public.invitations) <> (select token from t_inv), 'token stored hashed';
end $$;
select pg_temp.expect_error($$select public.create_invitation((select id from t_org), 'x@example.com', 'owner')$$, 'owner');

-- Dave (wrong email) cannot accept Bob's invitation
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select public.accept_invitation((select token from t_inv))$$, 'different email');
-- Dave cannot see team A
do $$ begin assert (select count(*) from public.organizations) = 0; end $$;
-- Dave cannot invite into team A
select pg_temp.expect_error($$select public.create_invitation((select id from t_org), 'x@example.com', 'member')$$, 'Only admins');
-- Dave cannot insert himself as member (no insert policy)
select pg_temp.expect_error($$insert into public.memberships (org_id, user_id, role) values ((select id from t_org), '00000000-0000-0000-0000-00000000000d', 'owner')$$, 'row-level security');

-- Bob accepts
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.accept_invitation((select token from t_inv));
select pg_temp.expect_error($$select public.accept_invitation((select token from t_inv))$$, 'already used');
do $$ begin
  assert (select role from public.memberships where user_id = '00000000-0000-0000-0000-00000000000b') = 'member';
  assert (select count(*) from public.org_members((select id from t_org))) = 2, 'bob sees both members';
  -- members cannot read invitations (admins only) or audit log
  assert (select count(*) from public.invitations) = 0;
  assert (select count(*) from public.audit_events) = 0;
end $$;

-- Bob (member) cannot promote himself
update public.memberships set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select role from public.memberships where user_id = '00000000-0000-0000-0000-00000000000b') = 'member', 'member cannot self-promote';
end $$;
-- Bob cannot update the org
update public.organizations set name = 'Hacked' where id = (select id from t_org);
do $$ begin assert (select name from public.organizations) = 'Älgjaktlaget Norr'; end $$;

-- Alice promotes Bob to admin; Bob (admin) cannot make himself owner
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.memberships set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$update public.memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000b'$$, 'Only owners');
select pg_temp.expect_error($$delete from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'Only owners');

-- The last owner cannot leave or be demoted
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.memberships set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'at least one owner');
select pg_temp.expect_error($$delete from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'at least one owner');

-- Audit log recorded membership changes and is visible to admins
do $$ begin
  assert (select count(*) from public.audit_events where entity = 'memberships') >= 3, 'audit events recorded';
end $$;

-- Carol still sees nothing of team A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.memberships) = 1;
  assert (select count(*) from public.audit_events where org_id = (select id from t_org)) = 0;
  assert (select count(*) from public.org_members((select id from t_org))) = 0, 'org_members respects membership';
  assert (select count(*) from public.profiles) = 1, 'carol sees only her own profile';
end $$;

-- Owner can delete the org; cascade must not trip the last-owner guard
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
delete from public.organizations where id = (select id from t_org_c);
do $$ begin assert (select count(*) from public.organizations) = 0; end $$;

rollback;
