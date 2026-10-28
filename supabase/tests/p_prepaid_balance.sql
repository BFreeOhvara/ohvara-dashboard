-- p_prepaid_balance — checks for the prepaid lead ledger (migration 176,
-- Roadmap Goal 3): a charge never takes a balance below 0, each lead is
-- charged once, a top-up is credited once.
--
-- Apply order before running this: 166 (leads.lead_type), then 176.
-- The two-session race checks are in prepaid_balance_concurrency.mjs (one
-- transaction can't race itself).
--
-- Run by the crew 2026-10-28 on a throwaway local PostgreSQL 18 (never live):
-- a minimal Supabase stand-in (roles, auth.uid(), auth.users, profiles, leads,
-- is_admin / is_fulfillment, the 160 sign-up trigger), then 166 and 176
-- verbatim: 0 failed. The full migration history was not replayed (it needs
-- pg_cron, pg_net and storage), so the door run on the real schema still counts.
--
-- ───────────────────────────────────────────────────────────────────────────
-- HOW TO RUN (at the door, right after applying 176, before the merge)
--   Paste the whole file into the SQL editor (or psql) as the postgres role.
--   It is one transaction that is rolled back; nothing stays. It makes its own
--   test agents (auth.users → profiles through the sign-up trigger) and leads,
--   and changes lead_prices only inside the transaction. The report comes back
--   as the error text of the last statement ("P_PREPAID_BALANCE RESULTS
--   (N failed)" then one PASS/FAIL line per check). N must be 0.
--
-- Checks (expected result in each line's label):
--   (a) balance 0: charge_lead → 'insufficient', no ledger row
--   (b) balance $40, price $30: first charge → 'charged', balance $10; a second
--       lead → 'insufficient'; balance stays >= 0
--   (c) the same lead charged twice → 'already_charged', one charge row
--   (d) a direct insert that would take balance_after_cents below 0 → CHECK
--       violation (23514); a client-sent balance_after_cents is ignored
--   (e) credit_topup: same session id twice → 'duplicate'; same event id with
--       a new session → 'duplicate'; credited once; amount <= 0 → raises 22023
--   (f) UPDATE / DELETE / TRUNCATE on the ledger → raise 42501
--   (g) as an agent: SELECT sees only their own rows and balance; INSERT,
--       charge_lead and credit_topup → permission denied (42501)
--   (h) lead type with no active price (no row, inactive, 'cancellation') →
--       'no_price', no row
--   (i) prices come from lead_prices: Meta (mortgage_protection) set to 3500 →
--       the next charge is 3500
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
  -- test agents (fake ids; auth.users + profiles made below, all rolled back)
  A  uuid := gen_random_uuid();   -- (a) zero balance
  B  uuid := gen_random_uuid();   -- (b)(c) $40 balance, $30 price
  D  uuid := gen_random_uuid();   -- (d) direct inserts
  E  uuid := gen_random_uuid();   -- (e) top-ups
  G1 uuid := gen_random_uuid();   -- (g) the signed-in agent
  G2 uuid := gen_random_uuid();   -- (g) someone else
  H  uuid := gen_random_uuid();   -- (h) no price
  I  uuid := gen_random_uuid();   -- (i) price change
  T  uuid[];
  tag text := replace(gen_random_uuid()::text, '-', '');   -- keeps Stripe ids unique
  L1 uuid; L2 uuid; L3 uuid; L4 uuid; L5 uuid; L6 uuid; L7 uuid; L8 uuid;
  c  record;
  k  integer;
  n  integer;
  bal bigint;
  err text;
  r  text := '';
  fails integer;
begin
  T := array[A, B, D, E, G1, G2, H, I];

  -- ── seed: accounts → profiles (the sign-up trigger makes the profile from app_metadata.role) ──
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'p_prepaid_' || u.nm || '_' || tag || '@example.invalid',
         '{"provider":"email","providers":["email"],"role":"agent"}'::jsonb,
         jsonb_build_object('full_name', 'Prepaid Test ' || u.nm),
         now(), now()
    from unnest(T, array['A', 'B', 'D', 'E', 'G1', 'G2', 'H', 'I']) as u(id, nm);
  select count(*) into k from public.profiles where id = any (T) and role::text = 'agent';
  r := r || pg_temp.chk('0 seed: 8 test agent profiles', k = 8, k::text);

  -- Known prices for this run (inside the transaction only): Meta $30, nothing for policy_review.
  insert into public.lead_prices (lead_type, price_cents, active) values ('mortgage_protection', 3000, true)
    on conflict (lead_type) do update set price_cents = 3000, active = true;
  insert into public.lead_prices (lead_type, price_cents, active) values ('policy_help', 5500, true)
    on conflict (lead_type) do update set price_cents = 5500, active = true;
  delete from public.lead_prices where lead_type = 'policy_review';

  -- ── (a) balance 0 → 'insufficient', no row ───────────────────────────────────
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid a', 'mortgage_protection', A) returning id into L1;
  select * into c from public.charge_lead(L1);
  select count(*) into k from public.agent_lead_ledger where agent_id = A;
  r := r || pg_temp.chk('a charge never takes balance below 0: balance 0 → insufficient, no row written',
         c.result = 'insufficient' and k = 0 and c.ledger_id is null,
         format('%s, rows %s, balance %s', c.result, k, c.balance_cents));

  -- ── (b) $40 balance, $30 price: one charge, then insufficient, never below 0 ──
  perform public.credit_topup(B, 4000, 'cs_test_pb_' || tag, 'evt_pb_' || tag);
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid b1', 'mortgage_protection', B) returning id into L2;
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid b2', 'mortgage_protection', B) returning id into L3;
  select * into c from public.charge_lead(L2);
  r := r || pg_temp.chk('b1 balance $40, price $30: first charge → charged, balance $10',
         c.result = 'charged' and c.charged_cents = 3000 and c.balance_cents = 1000,
         format('%s %s → %s', c.result, c.charged_cents, c.balance_cents));
  select * into c from public.charge_lead(L3);
  select count(*) into k from public.agent_lead_ledger where lead_id = L3;
  r := r || pg_temp.chk('b2 charge never takes balance below 0: second lead → insufficient, no row',
         c.result = 'insufficient' and k = 0 and c.balance_cents = 1000,
         format('%s, rows %s, balance %s', c.result, k, c.balance_cents));
  select balance_cents into bal from public.agent_lead_balance where agent_id = B;
  select count(*) into k from public.agent_lead_ledger where agent_id = B and balance_after_cents < 0;
  r := r || pg_temp.chk('b3 balance stays >= 0: view shows $10, no row below 0',
         bal = 1000 and k = 0, format('balance %s, rows below 0 %s', bal, k));

  -- ── (c) the same lead twice → 'already_charged', one row ─────────────────────
  select * into c from public.charge_lead(L2);
  select count(*) into k from public.agent_lead_ledger where lead_id = L2 and kind = 'charge';
  select balance_cents into bal from public.agent_lead_balance where agent_id = B;
  r := r || pg_temp.chk('c each lead charged once: same lead again → already_charged, one charge row, balance unchanged',
         c.result = 'already_charged' and k = 1 and bal = 1000 and c.charged_cents = 3000,
         format('%s, rows %s, balance %s', c.result, k, bal));

  -- ── (d) a direct insert below 0 fails the CHECK ──────────────────────────────
  err := '';
  begin
    insert into public.agent_lead_ledger (agent_id, kind, amount_cents, balance_after_cents, note)
      values (D, 'adjust', -100, 999999, 'p_prepaid_balance (d)');
  exception when others then err := sqlstate || ' ' || sqlerrm;
  end;
  select count(*) into k from public.agent_lead_ledger where agent_id = D;
  r := r || pg_temp.chk('d1 direct insert taking balance below 0 → CHECK violation 23514 (client balance_after ignored)',
         err like '23514%' and k = 0, coalesce(nullif(err, ''), 'no error'));
  err := '';
  begin
    insert into public.leads (business_name, lead_type, assigned_rep_id)
      values ('Prepaid d', 'mortgage_protection', D) returning id into L4;
    insert into public.agent_lead_ledger (agent_id, kind, amount_cents, balance_after_cents, lead_id, lead_type)
      values (D, 'charge', -3000, 0, L4, 'mortgage_protection');
  exception when others then err := sqlstate || ' ' || sqlerrm;
  end;
  select count(*) into k from public.agent_lead_ledger where agent_id = D;
  r := r || pg_temp.chk('d2 direct charge insert on a 0 balance → CHECK violation 23514',
         err like '23514%' and k = 0, coalesce(nullif(err, ''), 'no error'));

  -- ── (e) credit_topup: once per session id, once per event id, amount > 0 ───
  select * into c from public.credit_topup(E, 10000, 'cs_test_pe1_' || tag, 'evt_pe1_' || tag);
  r := r || pg_temp.chk('e1 first top-up → credited, balance $100',
         c.result = 'credited' and c.balance_cents = 10000, format('%s %s', c.result, c.balance_cents));
  select * into c from public.credit_topup(E, 10000, 'cs_test_pe1_' || tag, 'evt_pe2_' || tag);
  r := r || pg_temp.chk('e2 same stripe session id again (new event) → duplicate', c.result = 'duplicate', c.result);
  select * into c from public.credit_topup(E, 10000, 'cs_test_pe2_' || tag, 'evt_pe1_' || tag);
  r := r || pg_temp.chk('e3 same event id again (new session) → duplicate', c.result = 'duplicate', c.result);
  select count(*), coalesce(sum(amount_cents), 0) into k, bal from public.agent_lead_ledger where agent_id = E;
  r := r || pg_temp.chk('e4 credited once: one topup row, balance $100', k = 1 and bal = 10000, format('rows %s, sum %s', k, bal));
  err := '';
  begin
    perform public.credit_topup(E, 0, 'cs_test_pe3_' || tag, 'evt_pe3_' || tag);
  exception when others then err := sqlstate;
  end;
  r := r || pg_temp.chk('e5 amount 0 → rejected (22023)', err = '22023', coalesce(nullif(err, ''), 'no error'));
  err := '';
  begin
    perform public.credit_topup(E, -500, 'cs_test_pe4_' || tag, 'evt_pe4_' || tag);
  exception when others then err := sqlstate;
  end;
  select count(*) into k from public.agent_lead_ledger where agent_id = E;
  r := r || pg_temp.chk('e6 amount below 0 → rejected (22023), still one row', err = '22023' and k = 1,
         format('%s, rows %s', coalesce(nullif(err, ''), 'no error'), k));

  -- ── (f) the ledger is append-only ────────────────────────────────────────────
  err := '';
  begin
    update public.agent_lead_ledger set amount_cents = 999999 where agent_id = E;
  exception when others then err := sqlstate;
  end;
  r := r || pg_temp.chk('f1 UPDATE on the ledger → refused (42501)', err = '42501', coalesce(nullif(err, ''), 'no error'));
  err := '';
  begin
    delete from public.agent_lead_ledger where agent_id = E;
  exception when others then err := sqlstate;
  end;
  r := r || pg_temp.chk('f2 DELETE on the ledger → refused (42501)', err = '42501', coalesce(nullif(err, ''), 'no error'));
  err := '';
  begin
    truncate public.agent_lead_ledger;
  exception when others then err := sqlstate;
  end;
  select coalesce(sum(amount_cents), 0) into bal from public.agent_lead_ledger where agent_id = E;
  r := r || pg_temp.chk('f3 TRUNCATE on the ledger → refused (42501), row unchanged', err = '42501' and bal = 10000,
         format('%s, sum %s', coalesce(nullif(err, ''), 'no error'), bal));

  -- ── (g) RLS: an agent reads only their own rows and writes nothing ──────────
  perform public.credit_topup(G1, 2500, 'cs_test_pg1_' || tag, 'evt_pg1_' || tag);
  perform public.credit_topup(G2, 7500, 'cs_test_pg2_' || tag, 'evt_pg2_' || tag);
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid g', 'mortgage_protection', G1) returning id into L5;
  perform set_config('request.jwt.claims', json_build_object('sub', G1, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', G1::text, true);
  execute 'set local role authenticated';
  declare
    mine integer := -1; theirs integer := -1; vbal bigint; vrows integer := -1;
    read_err text := ''; ins_err text := ''; chg_err text := ''; top_err text := '';
  begin
    begin
      select count(*) into mine   from public.agent_lead_ledger where agent_id = G1;
      select count(*) into theirs from public.agent_lead_ledger where agent_id <> G1;
      select count(*) into vrows  from public.agent_lead_balance;
      select balance_cents into vbal from public.agent_lead_balance where agent_id = G1;
    exception when others then read_err := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.agent_lead_ledger (agent_id, kind, amount_cents, balance_after_cents, stripe_session_id)
        values (G1, 'topup', 100000, 0, 'cs_test_pg3_' || tag);
    exception when others then ins_err := sqlstate;
    end;
    begin
      perform public.charge_lead(L5);
    exception when others then chg_err := sqlstate;
    end;
    begin
      perform public.credit_topup(G1, 100000, 'cs_test_pg4_' || tag, 'evt_pg4_' || tag);
    exception when others then top_err := sqlstate;
    end;
    execute 'reset role';
    r := r || pg_temp.chk('g1 agent SELECT sees only their own ledger rows and balance row',
           read_err = '' and mine = 1 and theirs = 0 and vrows = 1 and vbal = 2500,
           format('own %s, others %s, balance rows %s, balance %s %s', mine, theirs, vrows, vbal, read_err));
    r := r || pg_temp.chk('g2 INSERT as the agent → denied (42501)', ins_err = '42501', coalesce(nullif(ins_err, ''), 'no error'));
    r := r || pg_temp.chk('g3 charge_lead / credit_topup as the agent → denied (42501)',
           chg_err = '42501' and top_err = '42501', format('charge %s, topup %s', chg_err, top_err));
  end;
  select count(*), sum(amount_cents) into k, bal from public.agent_lead_ledger where agent_id = G1;
  r := r || pg_temp.chk('g4 nothing written by the agent: one row, $25', k = 1 and bal = 2500, format('rows %s, sum %s', k, bal));

  -- ── (h) no active price → 'no_price' ─────────────────────────────────────────
  perform public.credit_topup(H, 50000, 'cs_test_ph_' || tag, 'evt_ph_' || tag);
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid h1', 'policy_review', H) returning id into L6;
  select * into c from public.charge_lead(L6);
  r := r || pg_temp.chk('h1 lead type with no price row (policy_review) → no_price', c.result = 'no_price', c.result);
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid h2', 'cancellation', H) returning id into L7;
  select * into c from public.charge_lead(L7);
  r := r || pg_temp.chk('h2 cancellation lead → no_price', c.result = 'no_price', c.result);
  update public.lead_prices set active = false where lead_type = 'policy_help';
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid h3', 'policy_help', H) returning id into L8;
  select * into c from public.charge_lead(L8);
  update public.lead_prices set active = true where lead_type = 'policy_help';
  select count(*) into k from public.agent_lead_ledger where agent_id = H and kind = 'charge';
  r := r || pg_temp.chk('h3 inactive price (policy_help off) → no_price; no charge rows for any', c.result = 'no_price' and k = 0,
         format('%s, charge rows %s', c.result, k));

  -- ── (i) the price comes from lead_prices ─────────────────────────────────────
  perform public.credit_topup(I, 10000, 'cs_test_pi_' || tag, 'evt_pi_' || tag);
  update public.lead_prices set price_cents = 3500, updated_at = now() where lead_type = 'mortgage_protection';
  insert into public.leads (business_name, lead_type, assigned_rep_id)
    values ('Prepaid i', 'mortgage_protection', I) returning id into L1;
  select * into c from public.charge_lead(L1);
  select amount_cents into n from public.agent_lead_ledger where lead_id = L1 and kind = 'charge';
  r := r || pg_temp.chk('i Meta price set to 3500 → next charge is 3500, balance $65',
         c.result = 'charged' and c.charged_cents = 3500 and n = -3500 and c.balance_cents = 6500,
         format('%s %s, row %s, balance %s', c.result, c.charged_cents, n, c.balance_cents));

  -- ── every test row: never below 0 ────────────────────────────────────────────
  select count(*) into k from public.agent_lead_ledger where agent_id = any (T) and balance_after_cents < 0;
  select count(*) into n from public.agent_lead_balance where agent_id = any (T) and balance_cents < 0;
  r := r || pg_temp.chk('z charge never takes balance below 0: no test row or balance below 0', k = 0 and n = 0,
         format('rows %s, balances %s', k, n));

  -- ── report: the exception aborts the transaction, so nothing stays; its text is the result ──
  fails := array_length(regexp_split_to_array(r, E'\nFAIL'), 1) - 1;
  raise exception 'P_PREPAID_BALANCE RESULTS (% failed):%', fails, r;
end $$;

rollback;
