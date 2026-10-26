-- Agent duty checks. Run after migration 172 in ONE transaction that is rolled
-- back: the final RAISE aborts it, and its message is the report. Uses the
-- live agent / admin profiles (B is a second agent, or the fulfillment rep if
-- there is only one agent); nothing stays.
do $$
declare
  A uuid := (select id from profiles where role::text = 'agent' and coalesce(is_active, true) order by created_at limit 1);
  B uuid := coalesce(
    (select id from profiles where role::text = 'agent' and coalesce(is_active, true) order by created_at offset 1 limit 1),
    (select id from profiles where role::text = 'fulfillment' and coalesce(is_active, true) order by created_at limit 1));
  M uuid := (select id from profiles where role::text = 'admin' and coalesce(is_active, true) order by created_at limit 1);
  r   text := '';
  k   integer;
  ok  boolean;
  fails integer := 0;
begin
  -- Seed as the table owner (bypasses RLS): A on duty, B off, an hour old.
  insert into public.agent_duty (agent_id, on_duty, updated_at) values (A, true, now() - interval '1 hour')
    on conflict (agent_id) do update set on_duty = true;
  insert into public.agent_duty (agent_id, on_duty) values (B, false)
    on conflict (agent_id) do update set on_duty = false;
  update public.agent_duty set updated_at = now() - interval '1 hour' where agent_id = A;

  -- 1. As B: can't read, update or create A's row; can't delete own row.
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into k from public.agent_duty where agent_id = A;
  r := r || format(E'\n%s other agent reads A''s row: %s', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  select count(*) into k from public.agent_duty;
  r := r || format(E'\n%s other agent sees only own row: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  update public.agent_duty set on_duty = false where agent_id = A;
  get diagnostics k = row_count;
  r := r || format(E'\n%s other agent updates A''s row: %s rows', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  begin
    update public.agent_duty set agent_id = A where agent_id = B;
    r := r || E'\nFAIL other agent moved own row onto A'; fails := fails + 1;
  exception when insufficient_privilege or unique_violation then r := r || E'\nPASS other agent can''t move own row onto A';
  end;
  begin
    insert into public.agent_duty (agent_id, on_duty) values (M, true);
    r := r || E'\nFAIL other agent inserted a row for someone else'; fails := fails + 1;
  exception when insufficient_privilege then r := r || E'\nPASS insert for someone else refused';
  end;
  delete from public.agent_duty where agent_id = B;
  get diagnostics k = row_count;
  r := r || format(E'\n%s no delete policy (own row): %s rows', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  select count(*) into k from public.on_duty_agents();
  r := r || format(E'\n%s non-admin on_duty_agents(): %s rows', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  execute 'reset role';

  -- 2. As A: own row readable and switchable; updated_at moves.
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.agent_duty set on_duty = true where agent_id = A;
  get diagnostics k = row_count;
  r := r || format(E'\n%s agent updates own row: %s rows', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  ok := (select updated_at = now() from public.agent_duty where agent_id = A);
  r := r || format(E'\n%s updated_at trigger', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not coalesce(ok, false))::int;
  select count(*) into k from public.on_duty_agents();
  r := r || format(E'\n%s agent on_duty_agents(): %s rows', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  execute 'reset role';

  -- 3. anon can't call it at all.
  execute 'set local role anon';
  begin
    perform public.on_duty_agents();
    r := r || E'\nFAIL anon called on_duty_agents()'; fails := fails + 1;
  exception when insufficient_privilege then r := r || E'\nPASS anon can''t call on_duty_agents()';
  end;
  execute 'reset role';

  -- 4. As the admin: sees A (on duty), not B (off).
  perform set_config('request.jwt.claims', json_build_object('sub', M, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := exists (select 1 from public.on_duty_agents() o where o.agent_id = A)
        and not exists (select 1 from public.on_duty_agents() o where o.agent_id = B);
  execute 'reset role';
  r := r || format(E'\n%s admin sees on-duty A, not off-duty B', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  raise exception 'AGENT DUTY RESULTS (% failed):%', fails, r;
end $$;
