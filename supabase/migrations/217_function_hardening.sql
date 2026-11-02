-- 217 — Function hardening: lock 5 functions off anon, pin 25 search_paths, move the
-- policies that call those 5 off anon.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step.
-- This is auth/RLS, so it goes through Brayden's door. No function body changes and no
-- row changes. Apply it after any earlier migration still unapplied on live, at a quiet
-- time: it takes brief locks on every altered table.
--
-- Why: Supabase's scan of live found 5 SECURITY DEFINER functions anon can execute and
-- 25 functions with a mutable search_path. Close them before real agents and clients
-- are on the app. Nobody should notice.
--
-- ANON: Postgres checks EXECUTE when a query starts, even if the condition would never
-- reach the function (see 190). So revoking anon's EXECUTE alone would turn a signed-out
-- read into a permission error on any table whose policy reaches anon and calls one of
-- the 5. Those policies move `to authenticated` with their rules untouched. Anon saw no
-- rows through them: every other branch is `column = auth.uid()`, null for anon.
--
-- A signed-out page does read one of these tables. PortalPhoneProvider wraps every route
-- and sends GET /rest/v1/carriers signed out. carriers_admin_write is on the list below,
-- so that read stays 0 rows and no error. Without the move it would be 42501.
--
-- leads_typed_update_assigned_only is RESTRICTIVE, so moving it off anon loosens it for
-- anon. It is safe here: the only permissive UPDATE policy on leads, leads_rep_update,
-- can't pass with a null auth.uid(), and its subquery on profiles already refuses anon
-- with 42501.
--
-- This block checks itself and raises if anything is off, which rolls all of it back,
-- because PGlite is a stand-in and only these checks run against the real database:
--   - a policy that matches and isn't on the reviewed list
--   - a listed policy that is RESTRICTIVE (other than the one above)
--   - a listed policy with neither public nor authenticated in its roles: moving it
--     would give signed-in users access they never had
--   - a signature missing from the database (the ALTER fails; there is no skip on purpose)
--   - lock_timeout: a busy table fails this cleanly instead of queueing reads behind it
-- A listed policy that isn't on the database gets a notice and is skipped.
--
-- KNOWN LIMIT: the list checks a policy by name. A same-named policy whose rule was
-- changed on live moves without that rule having been read.
--
-- LEFT ALONE: the other 82 definer functions, pg_net in public, leaked password
-- protection, and every policy not on the list.

do $$
declare
  c_locked constant text[] := array[
    'public.can_dm_thread(uuid,uuid)',
    'public.can_message_policy(uuid)',
    'public.is_admin()',
    'public.is_fulfillment()',
    'public.is_team_member()'
  ];
  c_pinned constant text[] := array[
    'public.set_updated_at()',
    'public.on_call_insert()',
    'public.eod_pipeline_sweep()',
    'public.handle_lead_pipeline()',
    'public.rep_completed_days(uuid,integer)',
    'public.notify_rep_on_message_reply()',
    'public.policy_agent_status(text,timestamptz,text)',
    'public.notify_rep_on_deal_closed()',
    'public.profiles_stamp_sms_opt_in()',
    'public.recovery_clear_trigger()',
    'public.recovery_local_at(date,time,text)',
    'public.rep_today_metrics(uuid)',
    'public.next_dom_occurrence(integer,date)',
    'public.advance_policy_lapse_check(uuid)',
    'public.reactivate_lapsed_policy(uuid)',
    'public.reset_lapse_check_notified()',
    'public.touch_fulfillment_details_updated_at()',
    'public.sms_consent_version()',
    'public.notifications_gate()',
    'public.notify_money(bigint)',
    'public.notify_client(public.policies)',
    'public.assign_daily_batches(integer)',
    'public.process_lead_queues()',
    'public.notify_assign_closer()',
    'public.sms_e164(text)'
  ];
  c_calls_the_5 constant text := '\m(can_dm_thread|can_message_policy|is_admin|is_fulfillment|is_team_member)\M';
  -- The reviewed list: schema, table, policy. Every rule here has been read.
  c_reviewed constant text[][] := array[
    ['public', 'agent_carrier_appointments',  'Admins manage all appointments'],
    ['public', 'agent_licenses',              'Admins manage all licenses'],
    ['public', 'agent_monthly_goals',         'Admins manage all monthly goals'],
    ['public', 'app_settings',                'Admins update app settings'],
    ['public', 'carriers',                    'carriers_admin_write'],
    ['public', 'closer_followups',            'closer_followups_delete'],
    ['public', 'closer_followups',            'closer_followups_insert'],
    ['public', 'closer_followups',            'closer_followups_select'],
    ['public', 'closer_followups',            'closer_followups_update'],
    ['public', 'commissions',                 'commissions_write_admin'],
    ['public', 'direct_message_reads',        'direct_message_reads_own'],
    ['public', 'direct_messages',             'direct_messages_insert'],
    ['public', 'direct_messages',             'direct_messages_select'],
    ['public', 'fulfillment_cancel_checks',   'fcc_admin_select'],
    ['public', 'fulfillment_cancel_events',   'fce_admin_select'],
    ['public', 'fulfillment_cancels',         'fc_select'],
    ['public', 'fulfillment_hour_fixes',      'fhf_admin_select'],
    ['public', 'fulfillment_pay',             'fulfillment_pay_admin_delete'],
    ['public', 'fulfillment_pay',             'fulfillment_pay_admin_insert'],
    ['public', 'fulfillment_pay',             'fulfillment_pay_admin_update'],
    ['public', 'fulfillment_pay',             'fulfillment_pay_select'],
    ['public', 'fulfillment_pay_runs',        'fpr_admin_select'],
    ['public', 'fulfillment_payout_accounts', 'fpa_select'],
    ['public', 'fulfillment_payouts',         'fp_select'],
    ['public', 'fulfillment_recordings',      'frec_admin_select'],
    ['public', 'fulfillment_time_entries',    'fte_admin_delete'],
    ['public', 'fulfillment_time_entries',    'fte_insert'],
    ['public', 'fulfillment_time_entries',    'fte_select'],
    ['public', 'fulfillment_time_entries',    'fte_update'],
    ['public', 'leads',                       'leads_typed_update_assigned_only'],
    ['public', 'policies',                    'fulfillment_select_assigned'],
    ['public', 'policies',                    'policies_insert'],
    ['public', 'policy_fulfillment_details',  'fulfillment_details_select'],
    ['public', 'policy_message_reads',        'policy_message_reads_own'],
    ['public', 'policy_messages',             'policy_messages_insert'],
    ['public', 'policy_messages',             'policy_messages_select'],
    ['public', 'profiles',                    'profiles_admin_update'],
    ['public', 'rep_invites',                 'rep_invites_delete'],
    ['public', 'rep_invites',                 'rep_invites_insert'],
    ['public', 'rep_invites',                 'rep_invites_select'],
    ['public', 'secrets',                     'secrets_admin_only'],
    ['public', 'team_conversations',          'team_conversations_insert'],
    ['public', 'training_progress',           'tp_admin_select'],
    ['public', 'training_videos',             'training_videos_admin_write']
  ];
  v_sig     text;
  v_before  jsonb := '{}';
  v_key     text;
  v_after   text;
  v_i       int;
  v_listed  boolean;
  p         record;
  v_left    text;
begin
  set local lock_timeout = '5s';

  -- ── 0. Snapshot the bodies ────────────────────────────────────────────────
  foreach v_sig in array c_locked || c_pinned loop
    select v_before || jsonb_build_object(v_sig, md5(f.prosrc)) into v_before
      from pg_proc f where f.oid = v_sig::regprocedure;
  end loop;

  -- ── 1. The 5: off anon and public, on for authenticated and service_role ──
  foreach v_sig in array c_locked loop
    execute format('revoke execute on function %s from anon, public', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;

  -- ── 2. The 25: pin the search_path, bodies untouched ──────────────────────
  foreach v_sig in array c_pinned loop
    execute format('alter function %s set search_path = public, pg_temp', v_sig);
  end loop;

  -- ── 3. Move the reviewed policies, rules untouched ────────────────────────
  for p in
    select schemaname, tablename, policyname, permissive, roles
      from pg_policies
     where schemaname in ('public', 'storage')
       and roles && array['public', 'anon']::name[]
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ c_calls_the_5
     order by 1, 2, 3
  loop
    v_listed := false;
    for v_i in 1 .. array_length(c_reviewed, 1) loop
      if c_reviewed[v_i][1] = p.schemaname and c_reviewed[v_i][2] = p.tablename and c_reviewed[v_i][3] = p.policyname then
        v_listed := true;
        exit;
      end if;
    end loop;

    if not v_listed then
      raise exception 'Policy %.%.% reaches anon and calls one of the 5 but is not on the reviewed list',
        p.schemaname, p.tablename, p.policyname;
    end if;
    if p.permissive = 'RESTRICTIVE' and p.policyname <> 'leads_typed_update_assigned_only' then
      raise exception 'Policy %.%.% is RESTRICTIVE: moving it off anon loosens it for anon',
        p.schemaname, p.tablename, p.policyname;
    end if;
    if not p.roles && array['public', 'authenticated']::name[] then
      raise exception 'Policy %.%.% has roles % : moving it would give signed-in users access they never had',
        p.schemaname, p.tablename, p.policyname, p.roles;
    end if;

    execute format('alter policy %I on %I.%I to authenticated', p.policyname, p.schemaname, p.tablename);
    raise notice 'Moved %.%.% to authenticated (was %)', p.schemaname, p.tablename, p.policyname, p.roles;
  end loop;

  for v_i in 1 .. array_length(c_reviewed, 1) loop
    if not exists (select 1 from pg_policies
                    where schemaname = c_reviewed[v_i][1]
                      and tablename  = c_reviewed[v_i][2]
                      and policyname = c_reviewed[v_i][3]) then
      raise notice 'No policy %.%.%, nothing to move', c_reviewed[v_i][1], c_reviewed[v_i][2], c_reviewed[v_i][3];
    end if;
  end loop;

  -- ── 4. Check the result ───────────────────────────────────────────────────
  select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ') into v_left
    from pg_policies
   where schemaname in ('public', 'storage')
     and roles && array['public', 'anon']::name[]
     and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ c_calls_the_5;
  if v_left is not null then
    raise exception 'Still on anon or public and calling one of the 5: %', v_left;
  end if;

  foreach v_key in array c_locked || c_pinned loop
    select md5(f.prosrc) into v_after from pg_proc f where f.oid = v_key::regprocedure;
    if v_after is distinct from v_before ->> v_key then
      raise exception 'The body of % changed', v_key;
    end if;
  end loop;

  foreach v_sig in array c_pinned loop
    if not exists (select 1 from pg_proc f
                    where f.oid = v_sig::regprocedure
                      and 'search_path=public, pg_temp' = any(f.proconfig)) then
      raise exception 'search_path is not pinned on %', v_sig;
    end if;
  end loop;

  foreach v_sig in array c_locked loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'anon can still execute %', v_sig;
    end if;
    if not (has_function_privilege('authenticated', v_sig, 'execute')
            and has_function_privilege('service_role', v_sig, 'execute')
            and has_function_privilege('postgres', v_sig, 'execute')) then
      raise exception 'authenticated, service_role or postgres lost execute on %', v_sig;
    end if;
  end loop;
end $$;
