-- p_function_hardening — pgTAP checks for 217_function_hardening.sql: the 5 locked
-- functions, the 25 pinned search_paths, the policies moved off anon, and proof that
-- nobody signed in or signed out gets a different answer.
--
-- RUN: `npm run test:sql -- supabase/tests/p_function_hardening.sql` (local PGlite) or
-- `supabase test db` on a LOCAL stack only. Everything runs in one transaction that is
-- rolled back. Never run it against Ohvara's live database.
--
-- Two kinds of check, by name:
--   'row ...'       hardcoded answers: what each role gets today. They pass with or
--                   without 217, so anyone can re-run them with 217 in place. Nothing
--                   here removes the migration.
--   'hardening ...' what 217 changes. They fail without it. A later function replaced
--                   without its SET clause, or a later policy that reaches anon and
--                   calls the 5, fails them by name.
--
-- The anon sweep pins today's answer per table, not a clean one. 13 tables anon can
-- select from already raise 42501, because a policy they keep reads profiles or calls
-- can_view_agent, and 9 relations have no anon grant at all. 217 doesn't cause those
-- and doesn't touch them. Each pin holds the code and the object the error names, so a
-- new error on another object fails. policy_fulfillment_details is the one table 217
-- changes for anon: it goes from 42501 to clean, so it is a hardening check.
--
-- Cast: A and B agents, F and G Fulfillment, Z admin. A's policy is assigned to F, B's
-- to G. Ids come from a name, so a role's rows read as a list of names.

begin;
create extension if not exists pgtap with schema extensions;
select plan(143);

-- ── helpers ─────────────────────────────────────────────────────────────────
create function public.p_fh_id(p text) returns uuid language sql immutable as $f$
  select md5('p_fh:' || p)::uuid
$f$;

-- Sign in by set_config: 'owner', 'anon' or a cast name.
create function public.p_fh_as(p_who text) returns void language plpgsql as $f$
begin
  if p_who = 'owner' then
    perform set_config('request.jwt.claims', '', true), set_config('role', 'none', true);
  elsif p_who = 'anon' then
    perform set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', public.p_fh_id(p_who), 'role', 'authenticated')::text, true),
            set_config('role', 'authenticated', true);
  end if;
end
$f$;

-- One value as text, or 'SQLSTATE: message'. Back to the owner either way.
create function public.p_fh_val(p_who text, p_expr text) returns text language plpgsql as $f$
declare v text;
begin
  perform public.p_fh_as(p_who);
  begin
    execute 'select (' || p_expr || ')::text' into v;
  exception when others then
    perform public.p_fh_as('owner');
    return sqlstate || ': ' || sqlerrm;
  end;
  perform public.p_fh_as('owner');
  return v;
end
$f$;

-- 'rows: N' for a query, or 'SQLSTATE: message'.
create function public.p_fh_rows(p_who text, p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  perform public.p_fh_as(p_who);
  begin
    execute 'select count(*) from (' || p_sql || ') q' into n;
  exception when others then
    perform public.p_fh_as('owner');
    return sqlstate || ': ' || sqlerrm;
  end;
  perform public.p_fh_as('owner');
  return 'rows: ' || n;
end
$f$;

-- 'changed: N' for a write, or 'SQLSTATE: message'.
create function public.p_fh_write(p_who text, p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  perform public.p_fh_as(p_who);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    perform public.p_fh_as('owner');
    return sqlstate || ': ' || sqlerrm;
  end;
  perform public.p_fh_as('owner');
  return 'changed: ' || n;
end
$f$;

-- Which of the seeded rows a role can see in a table, as a list of names.
create function public.p_fh_sees(p_who text, p_table text, p_names text[]) returns text language plpgsql as $f$
declare v text;
begin
  perform public.p_fh_as(p_who);
  begin
    execute format('select coalesce(string_agg(n, '','' order by n), '''') from unnest($1) n
                     where public.p_fh_id(n) in (select id from public.%I)', p_table)
      into v using p_names;
  exception when others then
    perform public.p_fh_as('owner');
    return sqlstate || ': ' || sqlerrm;
  end;
  perform public.p_fh_as('owner');
  return v;
end
$f$;

grant execute on function public.p_fh_id(text), public.p_fh_as(text) to anon, authenticated;

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', public.p_fh_id(u.n), 'authenticated', 'authenticated',
       'fh_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values ('A', 'agent'), ('B', 'agent'), ('F', 'fulfillment'), ('G', 'fulfillment'), ('Z', 'agent')) as u(n, role);

update public.profiles set role = 'admin' where id = public.p_fh_id('Z');
update public.app_settings set agent_billing_enforced = false, submit_live = true where id = 1;

insert into public.policies (id, agent_id, client_first_name, client_last_name, fulfillment_assigned)
values (public.p_fh_id('polA'), public.p_fh_id('A'), 'FH', 'Alpha', true),
       (public.p_fh_id('polB'), public.p_fh_id('B'), 'FH', 'Bravo', true);
update public.policies set assigned_fulfillment_id = public.p_fh_id('F') where id = public.p_fh_id('polA');
update public.policies set assigned_fulfillment_id = public.p_fh_id('G') where id = public.p_fh_id('polB');

insert into public.policy_messages (id, policy_id, sender_id, body)
values (public.p_fh_id('msgA'), public.p_fh_id('polA'), public.p_fh_id('A'), 'to F'),
       (public.p_fh_id('msgB'), public.p_fh_id('polB'), public.p_fh_id('B'), 'to G');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id, created_at)
values (public.p_fh_id('leadA'), 'FH Works', 'FH Alpha', '+15125550141', 'TX', 'mortgage_protection', 'google', public.p_fh_id('A'), now()),
       (public.p_fh_id('leadB'), 'FH Works', 'FH Bravo', '+15125550142', 'TX', 'mortgage_protection', 'google', public.p_fh_id('B'), now()),
       (public.p_fh_id('leadC'), 'FH Works', 'FH Cancel', '+15125550143', 'TX', 'cancellation', 'google', null, now());

-- One channel is all a database can have (migration seed), so it gets the cast's id.
update public.team_conversations set id = public.p_fh_id('chan') where type = 'channel';
insert into public.team_conversations (id, type, dm_participant_a, dm_participant_b)
values (public.p_fh_id('dmAZ'), 'dm', public.p_fh_id('A'), public.p_fh_id('Z')),
       (public.p_fh_id('dmBZ'), 'dm', public.p_fh_id('B'), public.p_fh_id('Z')),
       (public.p_fh_id('dmAB'), 'dm', public.p_fh_id('A'), public.p_fh_id('B'));

insert into public.team_messages (id, conversation_id, sender_id, sender_name, body)
values (public.p_fh_id('tmChan'), public.p_fh_id('chan'), public.p_fh_id('Z'), 'Z', 'all'),
       (public.p_fh_id('tmAZ'),   public.p_fh_id('dmAZ'), public.p_fh_id('A'), 'A', 'to Z'),
       (public.p_fh_id('tmBZ'),   public.p_fh_id('dmBZ'), public.p_fh_id('B'), 'B', 'to Z'),
       (public.p_fh_id('tmAB'),   public.p_fh_id('dmAB'), public.p_fh_id('A'), 'A', 'to B');

-- ── a. the 5, signed out ────────────────────────────────────────────────────
select is(public.p_fh_val('anon', 'public.is_admin()'),
          '42501: permission denied for function is_admin', 'hardening a1 anon is_admin() raises 42501');
select is(public.p_fh_val('anon', 'public.is_fulfillment()'),
          '42501: permission denied for function is_fulfillment', 'hardening a2 anon is_fulfillment() raises 42501');
select is(public.p_fh_val('anon', 'public.is_team_member()'),
          '42501: permission denied for function is_team_member', 'hardening a3 anon is_team_member() raises 42501');
select is(public.p_fh_val('anon', format('public.can_dm_thread(%L::uuid, null)', public.p_fh_id('A'))),
          '42501: permission denied for function can_dm_thread', 'hardening a4 anon can_dm_thread() raises 42501');
select is(public.p_fh_val('anon', format('public.can_message_policy(%L::uuid)', public.p_fh_id('polA'))),
          '42501: permission denied for function can_message_policy', 'hardening a5 anon can_message_policy() raises 42501');

-- ── b. the 5, signed in: a result, and the right one ────────────────────────
select is(public.p_fh_val('Z', 'public.is_admin()'), 'true', 'row b1 admin: is_admin() true');
select is(public.p_fh_val('A', 'public.is_admin()'), 'false', 'row b2 agent: is_admin() false');
select is(public.p_fh_val('F', 'public.is_fulfillment()'), 'true', 'row b3 fulfillment: is_fulfillment() true');
select is(public.p_fh_val('A', 'public.is_fulfillment()'), 'false', 'row b4 agent: is_fulfillment() false');
select is(public.p_fh_val('A', 'public.is_team_member()'), 'true', 'row b5 agent: is_team_member() true');
select is(public.p_fh_val('F', 'public.is_team_member()'), 'false', 'row b6 fulfillment: is_team_member() false');
select is(public.p_fh_val('A', format('public.can_dm_thread(%L::uuid, %L::uuid)', public.p_fh_id('A'), public.p_fh_id('F'))),
          'true', 'row b7 agent: can_dm_thread() with Fulfillment true');
select is(public.p_fh_val('B', format('public.can_dm_thread(%L::uuid, %L::uuid)', public.p_fh_id('A'), public.p_fh_id('F'))),
          'false', 'row b8 other agent: can_dm_thread() on A''s thread false');
select is(public.p_fh_val('A', format('public.can_message_policy(%L::uuid)', public.p_fh_id('polA'))),
          'true', 'row b9 agent: can_message_policy() on own policy true');
select is(public.p_fh_val('B', format('public.can_message_policy(%L::uuid)', public.p_fh_id('polA'))),
          'false', 'row b10 other agent: can_message_policy() on A''s policy false');

-- ── c. who holds execute ────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', f, 'execute'), 'hardening c anon has no execute on ' || f)
  from unnest(array['public.can_dm_thread(uuid,uuid)', 'public.can_message_policy(uuid)', 'public.is_admin()',
                    'public.is_fulfillment()', 'public.is_team_member()']) f;
select ok(has_function_privilege('authenticated', f, 'execute'), 'row c authenticated keeps execute on ' || f)
  from unnest(array['public.can_dm_thread(uuid,uuid)', 'public.can_message_policy(uuid)', 'public.is_admin()',
                    'public.is_fulfillment()', 'public.is_team_member()']) f;
select ok(has_function_privilege('service_role', f, 'execute'), 'row c service_role keeps execute on ' || f)
  from unnest(array['public.can_dm_thread(uuid,uuid)', 'public.can_message_policy(uuid)', 'public.is_admin()',
                    'public.is_fulfillment()', 'public.is_team_member()']) f;
select ok(has_function_privilege('postgres', f, 'execute'), 'row c postgres (cron) keeps execute on ' || f)
  from unnest(array['public.can_dm_thread(uuid,uuid)', 'public.can_message_policy(uuid)', 'public.is_admin()',
                    'public.is_fulfillment()', 'public.is_team_member()']) f;

-- ── d. the 25, each by name ─────────────────────────────────────────────────
create function public.p_fh_pinned(p_sig text) returns boolean language sql stable as $f$
  select coalesce((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p where p.oid = to_regprocedure(p_sig)), false)
$f$;

select ok(public.p_fh_pinned('public.set_updated_at()'), 'hardening d1 search_path pinned on set_updated_at');
select ok(public.p_fh_pinned('public.on_call_insert()'), 'hardening d2 search_path pinned on on_call_insert');
select ok(public.p_fh_pinned('public.eod_pipeline_sweep()'), 'hardening d3 search_path pinned on eod_pipeline_sweep');
select ok(public.p_fh_pinned('public.handle_lead_pipeline()'), 'hardening d4 search_path pinned on handle_lead_pipeline');
select ok(public.p_fh_pinned('public.rep_completed_days(uuid,integer)'), 'hardening d5 search_path pinned on rep_completed_days');
select ok(public.p_fh_pinned('public.notify_rep_on_message_reply()'), 'hardening d6 search_path pinned on notify_rep_on_message_reply');
select ok(public.p_fh_pinned('public.policy_agent_status(text,timestamptz,text)'), 'hardening d7 search_path pinned on policy_agent_status');
select ok(public.p_fh_pinned('public.notify_rep_on_deal_closed()'), 'hardening d8 search_path pinned on notify_rep_on_deal_closed');
select ok(public.p_fh_pinned('public.profiles_stamp_sms_opt_in()'), 'hardening d9 search_path pinned on profiles_stamp_sms_opt_in');
select ok(public.p_fh_pinned('public.recovery_clear_trigger()'), 'hardening d10 search_path pinned on recovery_clear_trigger');
select ok(public.p_fh_pinned('public.recovery_local_at(date,time,text)'), 'hardening d11 search_path pinned on recovery_local_at');
select ok(public.p_fh_pinned('public.rep_today_metrics(uuid)'), 'hardening d12 search_path pinned on rep_today_metrics');
select ok(public.p_fh_pinned('public.next_dom_occurrence(integer,date)'), 'hardening d13 search_path pinned on next_dom_occurrence');
select ok(public.p_fh_pinned('public.advance_policy_lapse_check(uuid)'), 'hardening d14 search_path pinned on advance_policy_lapse_check');
select ok(public.p_fh_pinned('public.reactivate_lapsed_policy(uuid)'), 'hardening d15 search_path pinned on reactivate_lapsed_policy');
select ok(public.p_fh_pinned('public.reset_lapse_check_notified()'), 'hardening d16 search_path pinned on reset_lapse_check_notified');
select ok(public.p_fh_pinned('public.touch_fulfillment_details_updated_at()'), 'hardening d17 search_path pinned on touch_fulfillment_details_updated_at');
select ok(public.p_fh_pinned('public.sms_consent_version()'), 'hardening d18 search_path pinned on sms_consent_version');
select ok(public.p_fh_pinned('public.notifications_gate()'), 'hardening d19 search_path pinned on notifications_gate');
select ok(public.p_fh_pinned('public.notify_money(bigint)'), 'hardening d20 search_path pinned on notify_money');
select ok(public.p_fh_pinned('public.notify_client(public.policies)'), 'hardening d21 search_path pinned on notify_client');
select ok(public.p_fh_pinned('public.assign_daily_batches(integer)'), 'hardening d22 search_path pinned on assign_daily_batches');
select ok(public.p_fh_pinned('public.process_lead_queues()'), 'hardening d23 search_path pinned on process_lead_queues');
select ok(public.p_fh_pinned('public.notify_assign_closer()'), 'hardening d24 search_path pinned on notify_assign_closer');
select ok(public.p_fh_pinned('public.sms_e164(text)'), 'hardening d25 search_path pinned on sms_e164');

-- ── e. no policy that reaches anon calls the 5 ──────────────────────────────
select is((select coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname, ', ' order by 1), '')
             from pg_policies
            where schemaname in ('public', 'storage')
              and roles && array['public', 'anon']::name[]
              and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '\m(can_dm_thread|can_message_policy|is_admin|is_fulfillment|is_team_member)\M'),
          '', 'hardening e1 no policy reaching anon or public calls the 5');

-- ── f. the anon sweep: today's answer, table by table ───────────────────────
create temp table p_fh_expected (rel text primary key, expected text not null);
insert into p_fh_expected
select rel, 'rows: 0' from unnest(array[
  'agent_billing_tiers', 'agent_carrier_appointments', 'agent_licenses', 'agent_monthly_goals', 'app_settings',
  'appointments', 'calls', 'carriers', 'closer_followups', 'commission_schedule', 'commissions', 'direct_message_reads',
  'direct_messages', 'follow_up_queue', 'fulfillment_pay', 'fulfillment_time_entries', 'leads', 'no_answer_queue',
  'notification_types', 'notifications', 'policy_message_reads', 'policy_messages', 'rep_invites', 'secrets',
  'team_conversations', 'team_messages', 'training_progress', 'training_videos']) rel;
-- Anon can select from these, and a policy they keep already refuses it.
insert into p_fh_expected
select rel, '42501: permission denied for table profiles' from unnest(array[
  'batch_assignments', 'bug_reports', 'clients', 'closer_rotation', 'commission_payouts', 'messages', 'onboarding',
  're_engagement_log', 'reminder_log', 'rep_credentials', 'subscriptions']) rel;
insert into p_fh_expected
select rel, '42501: permission denied for function can_view_agent' from unnest(array['policies', 'policy_events']) rel;
-- No anon grant at all: refused on the relation itself.
insert into p_fh_expected
select rel, '42501: permission denied for table ' || rel from unnest(array[
  'fulfillment_cancel_checks', 'fulfillment_cancel_events', 'fulfillment_cancels', 'fulfillment_hour_fixes',
  'fulfillment_pay_runs', 'fulfillment_payout_accounts', 'fulfillment_payouts', 'fulfillment_recordings', 'profiles']) rel;

-- Everything anon can select from, plus everything pinned, plus the one 217 changes.
create temp table p_fh_sweep as
select c.relname::text as rel, public.p_fh_rows('anon', format('select * from public.%I limit 1', c.relname)) as got
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'v', 'm', 'p')
   and (has_table_privilege('anon', c.oid, 'select')
        or c.relname in (select rel from p_fh_expected)
        or c.relname = 'policy_fulfillment_details');

select is(s.got, e.expected, 'row f anon select limit 1 on ' || e.rel)
  from p_fh_expected e left join p_fh_sweep s on s.rel = e.rel
 order by e.rel;

select is(public.p_fh_rows('anon', 'select * from public.policy_fulfillment_details limit 1'), 'rows: 0',
          'hardening f policy_fulfillment_details is clean for anon (42501 on can_view_agent before 217)');

-- A table added later and not pinned must be clean for anon: no error, no rows.
select is((select coalesce(string_agg(s.rel || ' => ' || s.got, '; ' order by s.rel), '')
             from p_fh_sweep s
            where s.rel not in (select rel from p_fh_expected)
              and s.rel <> 'policy_fulfillment_details'
              and s.got <> 'rows: 0'),
          '', 'row f anon-selectable relation with no pin gets no error and no rows');

select is((select coalesce(string_agg(s.rel || ' => ' || s.got, '; ' order by s.rel), '')
             from p_fh_sweep s
            where s.got ~ '\m(can_dm_thread|can_message_policy|is_admin|is_fulfillment|is_team_member)\M'),
          '', 'row f no anon error names one of the 5');

-- What the sweep's 0 rows mean: the rows are there, anon just doesn't get them.
select ok((select count(*) from public.carriers) > 0, 'row f carriers has rows as the owner');
-- The one database read a signed-out page sends (PortalPhoneProvider's useCarriers).
select is(public.p_fh_rows('anon', 'select * from public.carriers order by name'), 'rows: 0',
          'row f anon reads carriers as the app does: 0 rows, no 42501');

-- ── g. anon can't change a lead ─────────────────────────────────────────────
select is(public.p_fh_write('anon', format('update public.leads set contact_name = ''FH changed'' where id in (%L, %L, %L)',
                                           public.p_fh_id('leadA'), public.p_fh_id('leadB'), public.p_fh_id('leadC'))),
          '42501: permission denied for table profiles', 'row g1 anon update leads: 42501 naming table profiles');
select is((select count(*)::int from public.leads where contact_name = 'FH changed'), 0, 'row g2 anon update leads changed 0 rows');

-- ── h. same rows as before, by role and table ───────────────────────────────
-- policies
select is(public.p_fh_sees('Z', 'policies', array['polA', 'polB']), 'polA,polB', 'row h1 admin policies');
select is(public.p_fh_sees('A', 'policies', array['polA', 'polB']), 'polA', 'row h2 agent policies');
select is(public.p_fh_sees('F', 'policies', array['polA', 'polB']), 'polA', 'row h3 fulfillment policies');
-- leads
select is(public.p_fh_sees('Z', 'leads', array['leadA', 'leadB', 'leadC']), 'leadA,leadB,leadC', 'row h4 admin leads');
select is(public.p_fh_sees('A', 'leads', array['leadA', 'leadB', 'leadC']), 'leadA', 'row h5 agent leads');
select is(public.p_fh_sees('F', 'leads', array['leadA', 'leadB', 'leadC']), 'leadA,leadB,leadC', 'row h6 fulfillment leads');
-- policy_messages
select is(public.p_fh_sees('Z', 'policy_messages', array['msgA', 'msgB']), 'msgA,msgB', 'row h7 admin policy_messages');
select is(public.p_fh_sees('A', 'policy_messages', array['msgA', 'msgB']), 'msgA', 'row h8 agent policy_messages');
select is(public.p_fh_sees('F', 'policy_messages', array['msgA', 'msgB']), 'msgA', 'row h9 fulfillment policy_messages');
-- team_conversations
select is(public.p_fh_sees('Z', 'team_conversations', array['chan', 'dmAZ', 'dmBZ', 'dmAB']), 'chan,dmAZ,dmBZ', 'row h10 admin team_conversations');
select is(public.p_fh_sees('A', 'team_conversations', array['chan', 'dmAZ', 'dmBZ', 'dmAB']), 'chan,dmAB,dmAZ', 'row h11 agent team_conversations');
select is(public.p_fh_sees('F', 'team_conversations', array['chan', 'dmAZ', 'dmBZ', 'dmAB']), 'chan', 'row h12 fulfillment team_conversations');
-- team_messages
select is(public.p_fh_sees('Z', 'team_messages', array['tmChan', 'tmAZ', 'tmBZ', 'tmAB']), 'tmAZ,tmBZ,tmChan', 'row h13 admin team_messages');
select is(public.p_fh_sees('A', 'team_messages', array['tmChan', 'tmAZ', 'tmBZ', 'tmAB']), 'tmAB,tmAZ,tmChan', 'row h14 agent team_messages');
select is(public.p_fh_sees('F', 'team_messages', array['tmChan', 'tmAZ', 'tmBZ', 'tmAB']), 'tmChan', 'row h15 fulfillment team_messages');
-- anon, on the same seeded rows
select is(public.p_fh_sees('anon', 'leads', array['leadA', 'leadB', 'leadC']), '', 'row h16 anon leads');
select is(public.p_fh_sees('anon', 'policy_messages', array['msgA', 'msgB']), '', 'row h17 anon policy_messages');
select is(public.p_fh_sees('anon', 'team_conversations', array['chan', 'dmAZ', 'dmBZ', 'dmAB']), '', 'row h18 anon team_conversations');
select is(public.p_fh_sees('anon', 'team_messages', array['tmChan', 'tmAZ', 'tmBZ', 'tmAB']), '', 'row h19 anon team_messages');
select is(public.p_fh_sees('anon', 'policies', array['polA', 'polB']),
          '42501: permission denied for function can_view_agent', 'row h20 anon policies');

-- ── i. moved write policies still work for the signed-in ────────────────────
select is(public.p_fh_write('A', format('insert into public.policy_messages (policy_id, sender_id, body) values (%L, %L, ''fh write'')',
                                        public.p_fh_id('polA'), public.p_fh_id('A'))),
          'changed: 1', 'row i1 agent can post on own policy');
select is(public.p_fh_write('B', format('insert into public.policy_messages (policy_id, sender_id, body) values (%L, %L, ''fh write'')',
                                        public.p_fh_id('polA'), public.p_fh_id('B'))),
          '42501: new row violates row-level security policy for table "policy_messages"', 'row i2 other agent can''t post on A''s policy');
select is(public.p_fh_write('A', format('insert into public.team_conversations (type, dm_participant_a, dm_participant_b) values (''dm'', %L, %L)',
                                        public.p_fh_id('A'), public.p_fh_id('F'))),
          'changed: 1', 'row i3 agent can start a DM');
select is(public.p_fh_write('F', 'insert into public.team_conversations (type) values (''channel'')'),
          '42501: new row violates row-level security policy for table "team_conversations"', 'row i4 fulfillment can''t start a channel');
-- The restrictive policy moved with the rest: it must still hold signed-in users.
select is(public.p_fh_write('B', format('update public.leads set contact_name = ''FH changed'' where id = %L', public.p_fh_id('leadA'))),
          'changed: 0', 'row i5 other agent can''t change A''s lead');

select * from finish();
rollback;
