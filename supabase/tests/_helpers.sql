-- Shared test helpers (included by test files).
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
declare v_failed boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_failed := true;
    if sqlerrm not ilike '%' || p_like || '%' and sqlstate <> p_like then
      raise exception 'Unexpected error "%" (%), expected "%" for: %', sqlerrm, sqlstate, p_like, p_sql;
    end if;
  end;
  if not v_failed then
    raise exception 'Expected error matching "%" but statement succeeded: %', p_like, p_sql;
  end if;
end $$;

