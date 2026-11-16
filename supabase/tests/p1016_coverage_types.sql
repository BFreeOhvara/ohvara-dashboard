-- p1016_coverage_types — pgTAP checks for 281_lead_coverage_types.sql (Prompt 1016): the six lead types, admin edits,
-- the agent's one pick (now / from tomorrow), the nightly roll re-sending the campaign, leads stamped from the ad link
-- or the agent's type, agent_inbounds and ghl_claim_controls carrying it, what the AI caller says, the doors.
-- RUN: node scripts/run-sql-tests.mjs supabase/tests/p1016_coverage_types.sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p1016_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.name), now(), now()
  from (values
    ('f1016000-0000-4000-8000-00000000000a'::uuid, 'admin', 'fulfillment', 'Ada Admin'),
    ('f1016000-0000-4000-8000-00000000000b'::uuid, 'tess',  'agent',       'Tess Rowan'),
    ('f1016000-0000-4000-8000-00000000000c'::uuid, 'milo',  'agent',       'Milo Grant')
  ) as u(id, n, role, name);
update public.profiles set role = 'admin', is_active = true where id = 'f1016000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id in ('f1016000-0000-4000-8000-00000000000b', 'f1016000-0000-4000-8000-00000000000c');
insert into public.agent_lead_settings (agent_id, active, states) values
  ('f1016000-0000-4000-8000-00000000000b', true, '{TX,OK,LA}'),
  ('f1016000-0000-4000-8000-00000000000c', true, '{TX,OK,LA}')
on conflict (agent_id) do update set active = excluded.active, states = excluded.states;

-- ── a. The list ─────────────────────────────────────────────────────────────
select is((select array_agg(key order by sort) from public.coverage_types),
          array['mortgage_protection','final_expense','iul','truckers','veterans','term_life'], 'a1 six types in order');
select is(public.coverage_popular(), 'mortgage_protection', 'a2 Mortgage protection is Most popular');
select is(public.coverage_key_of('Final Expense'), 'final_expense', 'a3 a label matches');
select is(public.coverage_key_of('trucker'), 'truckers', 'a4 a singular matches');
select is(public.coverage_key_of('final-expense'), 'final_expense', 'a5 dashes match');
select is(public.coverage_key_of('cold calls'), null, 'a6 nothing else matches');

-- ── b. Admin edits ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"f1016000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select throws_ok($$select public.admin_coverage_type_popular('iul')$$, '42501', null, 'b1 an agent can''t move the tag');
select set_config('request.jwt.claims', '{"sub":"f1016000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$select public.admin_coverage_type_save('mortgage_protection', 'Mortgage protection', 'mortgage protection', '', true)$$,
                 '22023', null, 'b2 the Most popular type can''t be hidden');
select public.admin_coverage_type_save('veterans', 'Veterans & military', 'veterans life insurance', 'Vets', false);
select is((select label from public.coverage_types where key = 'veterans'), 'Veterans & military', 'b3 rename');
select public.admin_coverage_type_save('accidental_death', 'Accidental death', 'Accidental Death', 'AD&D', false);
select is((select sort from public.coverage_types where key = 'accidental_death'), 7, 'b4 a new type goes last');
select is((select words from public.coverage_types where key = 'accidental_death'), 'accidental death', 'b5 words are lower case');
select public.admin_coverage_type_popular('final_expense');
select is(public.coverage_popular(), 'final_expense', 'b6 the tag moves');
select is((select count(*)::int from public.coverage_types where most_popular), 1, 'b7 only one Most popular');
select public.admin_coverage_type_save('term_life', 'Term life', 'term life', '', true);
select is((select hidden from public.coverage_types where key = 'term_life'), true, 'b8 hide');
select public.admin_coverage_type_order(array['iul', 'final_expense']);
select is((select array_agg(key order by sort) from public.coverage_types where sort <= 2), array['iul','final_expense'], 'b9 reorder');
select throws_ok($$delete from public.coverage_types where key = 'iul'$$, '42501', null, 'b10 never deleted');
select ok(exists (select 1 from public.admin_audit_log where target_table = 'coverage_types' and target_id = 'veterans'), 'b11 edits are audit-logged');
select public.admin_coverage_type_popular('mortgage_protection');

-- ── c. The agent's pick ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"f1016000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select is(public.agent_coverage_of('f1016000-0000-4000-8000-00000000000b'), 'mortgage_protection', 'c1 never picked = Most popular');
select throws_ok($$select public.coverage_type_set(array['iul','truckers'])$$, '22023', null, 'c2 one type only (for now)');
select throws_ok($$select public.coverage_type_set(array['term_life'])$$, '22023', null, 'c3 a hidden type can''t be picked');
select throws_ok($$select public.coverage_type_set(array['nope'])$$, '22023', null, 'c4 an unknown type is refused');
select is(public.coverage_type_set(array['final_expense'])->'types', '["final_expense"]'::jsonb, 'c5 first pick takes effect now');
insert into public.agent_campaign_control (agent_id, lead_type, run, daily_budget_cents, reason, changed_at, pushed_at)
values ('f1016000-0000-4000-8000-00000000000b', 'appts', true, 5000, 'funded', now() - interval '1 hour', now() - interval '30 minutes');
select is(public.coverage_type_set(array['truckers'])->>'next_from',
          ((now() at time zone 'America/Chicago')::date + 1)::text, 'c6 with the campaign running, a switch starts tomorrow');
select is(public.agent_coverage_of('f1016000-0000-4000-8000-00000000000b'), 'final_expense', 'c7 today stays final expense');
select is(public.coverage_type_set(array['final_expense'])->'next_types', 'null'::jsonb, 'c8 picking today''s type cancels the switch');
select public.coverage_type_set(array['truckers']);
select set_config('request.jwt.claims', '{"sub":"f1016000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$select public.coverage_type_set(array['iul'])$$, '42501', null, 'c9 admins aren''t agents');

-- ── d. The nightly roll ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
update public.agent_coverage set next_from = (now() at time zone 'America/Chicago')::date where agent_id = 'f1016000-0000-4000-8000-00000000000b';
select is(public.coverage_type_roll(), 1, 'd1 one switch due');
select is(public.agent_coverage_of('f1016000-0000-4000-8000-00000000000b'), 'truckers', 'd2 now truckers');
select ok((select pushed_at < changed_at from public.agent_campaign_control where agent_id = 'f1016000-0000-4000-8000-00000000000b'),
          'd3 the campaign is due to be re-sent');
select is((select coverage_type || '|' || coverage_label from public.ghl_claim_controls(25) where agent_id = 'f1016000-0000-4000-8000-00000000000b'),
          'truckers|Truckers', 'd4 ghl-push sends the new type');
select is(public.coverage_type_roll(), 0, 'd5 nothing twice');

-- ── e. Leads carry the type ─────────────────────────────────────────────────
select is(public.ghl_intake_lead('{"intake_key":"p1016-1","phone":"(214) 555-1601","state":"TX","agent_id":"f1016000-0000-4000-8000-00000000000c","coverage_type":"IUL"}')->>'coverage_type',
          'iul', 'e1 the ad link''s type wins');
select is((select coverage_type from public.leads where phone = '+12145551601'), 'iul', 'e2 saved on the lead');
select is(public.ghl_intake_lead('{"intake_key":"p1016-2","phone":"(214) 555-1602","state":"TX","agent_id":"f1016000-0000-4000-8000-00000000000b"}')->>'coverage_type',
          'truckers', 'e3 no type in the link = the agent''s type');
select is(public.ghl_intake_lead('{"intake_key":"p1016-3","phone":"(214) 555-1603","state":"TX","agent_id":"f1016000-0000-4000-8000-00000000000c","product":"Final expense"}')->>'coverage_type',
          'final_expense', 'e4 "product" is read too');
select is((select coverage_type from public.lead_intake where intake_key = 'p1016-3'), 'final_expense', 'e5 logged on the intake');
select is(public.ghl_intake_lead('{"intake_key":"p1016-1","phone":"(214) 555-1601","state":"TX"}')->>'duplicate', 'true', 'e6 a retry is still a duplicate');
select is(public.ghl_intake_lead('{"intake_key":"p1016-4","phone":"(214) 555-1604","state":"TX"}')->>'coverage_type', null, 'e7 unmatched: no type yet');
update public.leads set assigned_rep_id = 'f1016000-0000-4000-8000-00000000000c' where phone = '+12145551604';
select is((select coverage_type from public.leads where phone = '+12145551604'), 'mortgage_protection', 'e8 assigned later: the agent''s type');
select is(public.coverage_words_for_lead((select id from public.leads where phone = '+12145551603')), 'final expense', 'e9 the AI says "final expense"');

-- ── f. Reads + doors ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"f1016000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.agent_inbounds() where coverage_type is not null), 3, 'f1 agent_inbounds carries the type');
reset role;
select ok(not has_function_privilege('anon', 'public.coverage_type_set(text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.coverage_type_roll()', 'execute')
          and not has_function_privilege('authenticated', 'public.ghl_intake_lead(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.ghl_intake_lead_p915(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.admin_coverage_type_save(text,text,text,text,boolean)', 'execute'),
          'f2 doors closed');

select * from finish();
rollback;
