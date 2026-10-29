-- p_assign_mp_lead — checks for public.assign_lead (migration 173, Roadmap Goal 2).
--
-- Written, not run by the crew; runs at the door after the migrations are applied.
--
-- Nothing here has been executed against any database. The crew has no Docker
-- or Supabase CLI on this PC and never runs SQL against Ohvara. The function's
-- caller (submit-mp-lead) is covered separately by fake-database tests:
--   deno test --allow-read supabase/functions/submit-mp-lead/
--
-- Lead model: ONE table, public.leads, typed by leads.lead_type (166). A /protect
-- lead is lead_type 'mortgage_protection', lead_source 'meta'. There is no
-- mp_leads table. Assignment is public.assign_lead(uuid) (173), service role
-- only, no charge. "Assigned" is leads.agent_status = 'assigned' plus
-- assigned_rep_id and delivered_at; leads.status is the cancellation pipeline
-- enum and stays 'New'.
--
-- Apply order before running this: 166, then 173.
--
-- ───────────────────────────────────────────────────────────────────────────
-- 1. HOW TO RUN (at the door)
--    Paste the whole file into the SQL editor (or psql) as the postgres role.
--    It is one transaction that is rolled back; nothing stays. The report comes
--    back as the error text of the last statement ("P_ASSIGN_MP_LEAD RESULTS
--    (N failed)" then one PASS/FAIL line per check). N must be 0. Real agents'
--    opt-in rows are switched off INSIDE the transaction only, so a real opted-in
--    agent can't take a test lead; that switch is rolled back too.
--
-- 2. SEED FOR THE REAL TEST AGENT (not run by this file; run it on its own, it
--    is the one write that stays). The test account is testagent11 / nate44,
--    id 3f2b2df7-40b1-4921-80e2-09981c819642 (src/lib/testAccounts.js). Opted in,
--    state TX (the state used by the /protect test submission), daily cap 5:
--
--      insert into public.agent_lead_settings (agent_id, active, states, daily_cap)
--      values ('3f2b2df7-40b1-4921-80e2-09981c819642', true, '{TX}', 5)
--      on conflict (agent_id) do update
--        set active = true, states = '{TX}', daily_cap = 5, updated_at = now();
--
-- 3. POST-APPLY CHECKLIST
--      [ ] 166 then 173 applied (173 stops itself if 166 is missing).
--      [ ] Run this file: expect "P_ASSIGN_MP_LEAD RESULTS (0 failed)".
--      [ ] Run the seed in section 2.
--      [ ] Deploy submit-mp-lead.
--      [ ] Submit /protect once with state TX and a made-up phone (+1512555xxxx).
--          Expect exactly one leads row: lead_type 'mortgage_protection',
--          agent_status 'assigned', assigned_rep_id = the test agent,
--          delivered_at set:
--            select id, lead_type, state, agent_status, assigned_rep_id, delivered_at
--              from public.leads where phone = '<that phone>';
--      [ ] Submit the same phone again: expect still exactly one row (the 30-day
--          repeat-phone drop), and the reply is still {"ok":true}.
--      [ ] Delete or deactivate the test row when done (active = false).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- One line per check: PASS or FAIL, label, detail. (A temp function, rolled back with the rest.)
create function pg_temp.chk(label text, ok boolean, detail text default '')
returns text language sql as $$
  select E'\n' || case when coalesce(ok, false) then 'PASS' else 'FAIL' end || ' ' || label
         || case when detail <> '' then ' (' || detail || ')' else '' end
$$;

do $$
declare
  -- test agents (fake ids; auth.users + profiles + agent_lead_settings rows made below, all rolled back)
  A  uuid := gen_random_uuid();   -- opted in, TX, cap 3: the one that should win
  B  uuid := gen_random_uuid();   -- opted OUT, TX
  C  uuid := gen_random_uuid();   -- opted in, FL only (wrong state for a TX lead)
  D  uuid := gen_random_uuid();   -- opted in, TX, cap 1, already has 1 lead today (at cap)
  D2 uuid := gen_random_uuid();   -- opted in, TX, cap 1, its one lead was delivered 2 days ago (under cap today)
  E  uuid := gen_random_uuid();   -- opted in, TX, no cap, 1 lead today
  F  uuid := gen_random_uuid();   -- opted in, TX, no cap, 0 leads today (fewer than E)
  T  uuid[];
  L1 uuid; L2 uuid; L3 uuid; L4 uuid; L5 uuid; L6 uuid; L7 uuid; L8 uuid;
  got uuid;
  lr  record;
  r   text := '';
  k   integer;
  t0  timestamptz;
  ledger_before text;
  ledger_after  text;
  ledger_tables text;
  src text;
  err text;
  fails integer;
begin
  T := array[A, B, C, D, D2, E, F];

  -- ── seed: accounts → profiles (the sign-up trigger makes the profile from app_metadata.role) ──
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'p_assign_' || n || '@example.invalid',
         '{"provider":"email","providers":["email"],"role":"agent"}'::jsonb,
         jsonb_build_object('full_name', 'Test Agent ' || n),
         now(), now()
    from unnest(T, array['A', 'B', 'C', 'D', 'D2', 'E', 'F']) as u(id, n);

  -- Real opt-ins out of the way (inside this transaction only), so only the test agents compete.
  update public.agent_lead_settings set active = false where agent_id <> all (T);

  insert into public.agent_lead_settings (agent_id, active, states, daily_cap) values
    (A,  true,  '{TX}',    3),
    (B,  false, '{TX}',    null),
    (C,  true,  '{FL}',    null),
    (D,  true,  '{TX}',    1),
    (D2, true,  '{TX}',    1),
    (E,  true,  '{TX}',    null),
    (F,  true,  '{TX}',    null);

  -- Seeded deliveries: D already has its 1 today; D2's one was 2 days ago; E has 1 today.
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state, assigned_rep_id, delivered_at, agent_status) values
    ('mortgage_protection', 'meta', 'Seed D',  'Seed D',  '+15125550401', 'TX', D,  now(),                      'assigned'),
    ('mortgage_protection', 'meta', 'Seed D2', 'Seed D2', '+15125550402', 'TX', D2, now() - interval '2 days',  'assigned'),
    ('mortgage_protection', 'meta', 'Seed E',  'Seed E',  '+15125550403', 'TX', E,  now(),                      'assigned');

  -- Tables that would hold money (ledger / balance / wallet / charge): snapshot their row counts
  -- before any assignment. None exist until the prepaid-balance goal; the check still holds then.
  select string_agg(relname, ', ' order by relname) into ledger_tables
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relname ~* '(ledger|balance|wallet|charge)';
  select coalesce(string_agg(relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text,
           ',' order by relname), 'none')
    into ledger_before
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relname ~* '(ledger|balance|wallet|charge)';

  -- ── 1. Opted-in agent in the state and under cap gets the lead ─────────────
  update public.agent_lead_settings set active = (agent_id = A) where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 1', 'Lead 1', '+15125550411', 'TX') returning id into L1;
  got := public.assign_lead(L1);
  select * into lr from public.leads where id = L1;
  r := r || pg_temp.chk('1a opted-in TX agent under cap: assign_lead returns that agent', got = A, coalesce(got::text, 'null'));
  r := r || pg_temp.chk('1b lead row: agent_status assigned, assigned_rep_id = agent, delivered_at set',
         lr.agent_status = 'assigned' and lr.assigned_rep_id = A and lr.delivered_at is not null,
         format('%s / %s / %s', lr.agent_status, lr.assigned_rep_id, lr.delivered_at));
  r := r || pg_temp.chk('1c lead stays the typed mortgage_protection lead, cancellation status untouched',
         lr.lead_type = 'mortgage_protection' and lr.status::text = 'New', format('%s / %s', lr.lead_type, lr.status));
  t0 := lr.delivered_at;

  -- ── 2. Agents who must get nothing (one reason each, everyone else off) ─────
  -- 2a off (B is opted out; right state, no cap)
  update public.agent_lead_settings set active = false where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 2a', 'Lead 2a', '+15125550421', 'TX') returning id into L2;
  got := public.assign_lead(L2);
  select * into lr from public.leads where id = L2;
  r := r || pg_temp.chk('2a agent switched off gets nothing; lead stays new, unassigned',
         got is null and lr.assigned_rep_id is null and lr.agent_status is null and lr.delivered_at is null,
         coalesce(got::text, 'null'));

  -- 2b wrong state (C is opted in for FL only; lead is TX)
  update public.agent_lead_settings set active = (agent_id = C) where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 2b', 'Lead 2b', '+15125550422', 'TX') returning id into L3;
  got := public.assign_lead(L3);
  select * into lr from public.leads where id = L3;
  r := r || pg_temp.chk('2b agent opted in for another state gets nothing',
         got is null and lr.assigned_rep_id is null and lr.agent_status is null, coalesce(got::text, 'null'));

  -- 2c at the daily cap (D: cap 1, 1 delivered today)
  update public.agent_lead_settings set active = (agent_id = D) where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 2c', 'Lead 2c', '+15125550423', 'TX') returning id into L4;
  got := public.assign_lead(L4);
  select * into lr from public.leads where id = L4;
  r := r || pg_temp.chk('2c agent at their daily cap gets nothing',
         got is null and lr.assigned_rep_id is null and lr.agent_status is null, coalesce(got::text, 'null'));

  -- 2d yesterday's deliveries do not count toward today's cap (D2: cap 1, its lead was 2 days ago)
  update public.agent_lead_settings set active = (agent_id = D2) where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 2d', 'Lead 2d', '+15125550424', 'TX') returning id into L5;
  got := public.assign_lead(L5);
  r := r || pg_temp.chk('2d an older delivery does not count against today''s cap', got = D2, coalesce(got::text, 'null'));

  -- ── 3. Two qualify: the one with fewer leads today wins ─────────────────────
  update public.agent_lead_settings set active = (agent_id in (E, F)) where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 3', 'Lead 3', '+15125550431', 'TX') returning id into L6;
  got := public.assign_lead(L6);
  r := r || pg_temp.chk('3 E has 1 lead today, F has 0: F wins', got = F, coalesce(got::text, 'null'));

  -- ── 4. Nobody qualifies: lead stays new, no error ───────────────────────────
  update public.agent_lead_settings set active = false where agent_id = any (T);
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
    values ('mortgage_protection', 'meta', 'Lead 4', 'Lead 4', '+15125550441', 'TX') returning id into L7;
  err := null;
  begin
    got := public.assign_lead(L7);
  exception when others then err := sqlstate || ' ' || sqlerrm;
  end;
  select * into lr from public.leads where id = L7;
  r := r || pg_temp.chk('4 nobody qualifies: no error, returns null, lead stays new',
         err is null and got is null and lr.assigned_rep_id is null and lr.agent_status is null
           and lr.delivered_at is null and lr.status::text = 'New',
         coalesce(err, 'no error'));

  -- ── 5. Calling assign twice does not reassign ───────────────────────────────
  -- L1 went to A. Now F (0 leads → fewer) is available as well; a second call must still return A.
  update public.agent_lead_settings set active = (agent_id in (A, F)) where agent_id = any (T);
  got := public.assign_lead(L1);
  select * into lr from public.leads where id = L1;
  select count(*) into k from public.leads where assigned_rep_id = A and delivered_at is not null and lead_type = 'mortgage_protection';
  r := r || pg_temp.chk('5a second assign_lead(L1): still the first agent, same delivered_at',
         got = A and lr.assigned_rep_id = A and lr.delivered_at = t0, coalesce(got::text, 'null'));
  r := r || pg_temp.chk('5b that agent has exactly 1 delivered lead (no double count)', k = 1, k::text);
  -- and an unassigned lead picked up on a later call is assigned exactly once
  update public.agent_lead_settings set active = (agent_id = A) where agent_id = any (T);
  got := public.assign_lead(L7);
  select count(*) into k from public.leads where id = L7 and assigned_rep_id = A and agent_status = 'assigned';
  r := r || pg_temp.chk('5c a lead left new earlier is assigned on a later call (once)', got = A and k = 1, coalesce(got::text, 'null'));
  got := public.assign_lead(L7);
  select count(*) into k from public.leads where assigned_rep_id = A and delivered_at is not null and lead_type = 'mortgage_protection';
  r := r || pg_temp.chk('5d calling it again changes nothing', got = A and k = 2, format('%s leads for the agent', k));

  -- ── 6. Assignment touches no ledger or balance table ────────────────────────
  select coalesce(string_agg(relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text,
           ',' order by relname), 'none')
    into ledger_after
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relname ~* '(ledger|balance|wallet|charge)';
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into src from pg_proc where oid = 'public.assign_lead(uuid)'::regprocedure;
  r := r || pg_temp.chk('6a assign_lead code (comments removed) never mentions a ledger, balance, wallet or charge',
         src !~* '(ledger|balance|wallet|charge)', 'tables looked at: ' || coalesce(ledger_tables, 'none exist yet'));
  r := r || pg_temp.chk('6b row counts of any ledger/balance tables unchanged by all the assignments above',
         ledger_before = ledger_after, ledger_before || ' -> ' || ledger_after);

  -- ── 7. A signed-in agent cannot write or assign, and reads only their own ───
  -- A holds L1 and L7 (typed). F holds L6 (another agent's lead). L2..L4 are unassigned (see 2a-2c).
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  declare
    ins_ok boolean := false; ins_err text := '';
    asg_ok boolean := false; asg_err text := '';
    other_seen integer := -1; own_seen integer := -1; unassigned_seen integer := -1; read_err text := '';
  begin
    begin
      insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state)
        values ('mortgage_protection', 'meta', 'Agent made', 'Agent made', '+15125550451', 'TX');
      ins_ok := true;
    exception when others then ins_err := sqlstate;
    end;
    begin
      perform public.assign_lead(L2);
      asg_ok := true;
    exception when others then asg_err := sqlstate;
    end;
    begin
      select count(*) into other_seen from public.leads where id = L6;                      -- F's lead
      select count(*) into own_seen from public.leads where id = L1;                        -- A's own lead
      select count(*) into unassigned_seen from public.leads where id in (L2, L3, L4);      -- nobody's lead
    exception when others then read_err := sqlstate || ' ' || sqlerrm;
    end;
    execute 'reset role';
    r := r || pg_temp.chk('7a agent cannot insert a lead (typed lead is service-role only)',
           not ins_ok and ins_err = '42501', case when ins_ok then 'insert succeeded' else 'sqlstate ' || ins_err end);
    r := r || pg_temp.chk('7b agent cannot call assign_lead',
           not asg_ok and asg_err = '42501', case when asg_ok then 'call succeeded' else 'sqlstate ' || asg_err end);
    r := r || pg_temp.chk('7c agent cannot read another agent''s lead', other_seen = 0 and read_err = '',
           format('saw %s; %s', other_seen, read_err));
    r := r || pg_temp.chk('7d agent cannot read a typed lead nobody has', unassigned_seen = 0 and read_err = '',
           format('saw %s', unassigned_seen));
    r := r || pg_temp.chk('7e agent still reads their own lead (the guard is not blocking everything)', own_seen = 1 and read_err = '',
           format('saw %s', own_seen));
  end;

  -- Opt-in rows: an agent changes only their own.
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  declare
    mine integer; theirs integer; upd_err text := '';
  begin
    begin
      select count(*) into mine from public.agent_lead_settings where agent_id = A;
      select count(*) into theirs from public.agent_lead_settings where agent_id <> A;
    exception when others then upd_err := sqlstate || ' ' || sqlerrm;
    end;
    execute 'reset role';
    r := r || pg_temp.chk('7f agent reads their own opt-in row and no one else''s', mine = 1 and theirs = 0 and upd_err = '',
           format('own %s, others %s %s', mine, theirs, upd_err));
  end;

  -- ── report: the exception aborts the transaction, so nothing stays; its text is the result ──
  fails := array_length(regexp_split_to_array(r, E'\nFAIL'), 1) - 1;
  raise exception 'P_ASSIGN_MP_LEAD RESULTS (% failed):%', fails, r;
end $$;

rollback;
