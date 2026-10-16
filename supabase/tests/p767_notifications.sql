-- Prompt 767 — notification checks. Run after migration 146 in ONE transaction
-- that is rolled back: the final RAISE aborts it, and its message is the
-- report. Uses the live agent / fulfillment / admin profiles; nothing stays.
do $$
declare
  A uuid := (select id from profiles where role::text = 'agent' and coalesce(is_active, true) order by created_at limit 1);
  F uuid := (select id from profiles where role::text = 'fulfillment' and coalesce(is_active, true) order by created_at limit 1);
  M uuid := (select id from profiles where role::text = 'admin' and coalesce(is_active, true) order by created_at limit 1);
  pol uuid := gen_random_uuid();
  pol2 uuid := gen_random_uuid();
  pol3 uuid := gen_random_uuid();
  inv uuid := gen_random_uuid();
  r   text := '';
  k   integer;
  ok  boolean;
  x   uuid;
  j   jsonb;
  fails integer := 0;
begin
  -- quiet emails out of the way: only count what this test makes
  delete from notification_emails;

  -- helper: record a check
  -- (inline: r := r || check line)

  -- 1. Booked for the rep, once.
  insert into policies (id, agent_id, client_first_name, client_last_name, carrier_name, status,
                        fulfillment_assigned, assigned_fulfillment_id, scheduled_call_at, fulfillment_stage)
  values (pol, A, 'Test', 'Lopez', 'State Farm', 'In Effect', true, F, now() + interval '1 day', 'Pending');
  select count(*) into k from notifications where profile_id = F and type = 'call_booked' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s booked → rep: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  update policies set notes = 'touch' where id = pol;
  select count(*) into k from notifications where profile_id = F and type = 'call_booked' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s no dupe on unrelated update: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  x := public.notify(F, 'call_booked', 't', 'd', '/x', false, 'booked:' || pol || ':' || extract(epoch from (select scheduled_call_at from policies where id = pol))::bigint);
  r := r || format(E'\n%s same dedupe key twice → null: %s', case when x is null then 'PASS' else 'FAIL' end, x); fails := fails + (x is not null)::int;

  -- 2. No answer (texting off) → agent, needs action.
  update policies set last_call_outcome = 'no_answer', last_call_at = now() where id = pol;
  select count(*) into k from notifications where profile_id = A and type = 'client_no_answer' and needs_action and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s no answer → agent (needs you): %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  update policies set last_call_outcome = 'no_answer' where id = pol;  -- same call, saved again
  select count(*) into k from notifications where profile_id = A and type = 'client_no_answer' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s no answer saved twice → still 1: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;

  -- 3. Text flow steps.
  update policies set recovery_phase = 1, recovery_step = 'number_check' where id = pol;
  select count(*) into k from notifications where profile_id = A and type = 'client_no_answer' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s number check → agent: %s', case when k = 2 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 2)::int;
  update policies set recovery_phase = 2, recovery_step = 'call_directly', recovery_handoff_at = now() where id = pol;
  select count(*) into k from notifications where profile_id = A and type = 'client_unreachable' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s call directly → agent: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;

  -- 4. Messages both ways.
  insert into policy_messages (policy_id, sender_id, sender_name, sender_role, body) values (pol, A, 'Agent T', 'agent', 'Can you check this?');
  insert into policy_messages (policy_id, sender_id, sender_name, sender_role, body) values (pol, F, 'Rep T', 'fulfillment', 'On it');
  -- (sender names are stamped from profiles, so match on the thread link)
  select count(*) into k from notifications where type = 'message' and link = '/messages?thread=' || pol and profile_id in (A, F);
  r := r || format(E'\n%s policy messages → the other side: %s', case when k = 2 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 2)::int;

  -- 5. Cancelled → agent; the cancel row → needs a listen → admin.
  update policies set fulfillment_stage = 'Complete', fulfillment_completed_at = now() where id = pol;
  select count(*) into k from notifications where profile_id = A and type = 'policy_cancelled' and data->>'policy_id' = pol::text;
  r := r || format(E'\n%s cancelled → agent: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  update fulfillment_cancels set status = 'needs_listen', reason = 'unclear' where policy_id = pol;
  -- (with no recording the cancel can be born needs_listen, reason no_recording)
  select count(*) into k from notifications where profile_id = M and type = 'needs_listen'
     and data->>'cancel_id' = (select id::text from fulfillment_cancels where policy_id = pol);
  r := r || format(E'\n%s needs a listen → admin: %s (%s)', case when k = 1 then 'PASS' else 'FAIL' end, k,
    (select detail from notifications where profile_id = M and type = 'needs_listen' order by created_at desc limit 1));
  fails := fails + (k <> 1)::int;

  -- 6. Pay run short → admin bell + email (email on by default).
  insert into fulfillment_pay_runs (pay_date, period_start, status, needed_cents, balance_cents)
  values (date '2027-11-22', date '2027-11-15', 'short_balance', 28000, 16000);
  select count(*) into k from notifications where profile_id = M and type = 'payout_problem' and title like '%$120 short%';
  r := r || format(E'\n%s short pay run → admin: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  select count(*) into k from notification_emails where profile_id = M and type = 'payout_problem' and send_after <= now() + interval '1 second';
  r := r || format(E'\n%s money email queued now (no quiet hours): %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;

  -- 7. Email toggle respected (as the admin, through the RPC).
  perform set_config('request.jwt.claims', json_build_object('sub', M, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_notification_email('payout_problem', false);
  j := public.my_money_banner();
  execute 'reset role';
  r := r || format(E'\n%s admin banner = short balance: %s', case when j->>'kind' = 'short_balance' then 'PASS' else 'FAIL' end, j->>'title');
  fails := fails + (coalesce(j->>'kind', '') <> 'short_balance')::int;
  insert into fulfillment_pay_runs (pay_date, period_start, status, note) values (date '2027-11-29', date '2027-11-22', 'error', 'Stripe timeout');
  select count(*) into k from notifications where profile_id = M and type = 'payout_problem';
  r := r || format(E'\n%s email off → bell yes (%s), no new email (emails %s)', case when k = 2 and (select count(*) from notification_emails where profile_id = M and type = 'payout_problem') = 1 then 'PASS' else 'FAIL' end, k,
                   (select count(*) from notification_emails where profile_id = M and type = 'payout_problem'));
  fails := fails + (not (k = 2 and (select count(*) from notification_emails where profile_id = M and type = 'payout_problem') = 1))::int;

  -- 8. Agent payment failed → agent + admin.
  update profiles set billing_exempt = false, billing_status = 'active' where id = A;
  update profiles set billing_status = 'past_due', billing_updated_at = now() where id = A;
  select count(*) into k from notifications where (profile_id = A and type = 'payment_failed') or (profile_id = M and type = 'agent_payment_failed');
  r := r || format(E'\n%s payment failed → agent + admin: %s', case when k = 2 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 2)::int;

  -- 9. Payouts: paid / failed / held → rep (+ admin on failed).
  insert into fulfillment_payouts (id, rep_id, period_start, period_end, amount_cents, status)
  values (pol2, F, date '2027-12-06', date '2027-12-12', 23000, 'upcoming');
  update fulfillment_payouts set status = 'held' where id = pol2;
  update fulfillment_payouts set status = 'failed', failure_reason = 'Bank closed' where id = pol2;
  select count(*) into k from notifications where (profile_id = F and type = 'pay_problem') or (profile_id = M and type = 'payout_problem' and title like 'Transfer to%');
  r := r || format(E'\n%s held + failed → rep x2, admin x1: %s', case when k = 3 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 3)::int;
  update fulfillment_payouts set status = 'paid', stripe_transfer_id = 'tr_test', paid_at = now(), paid_to = 'Chase •••• 4821' where id = pol2;
  select count(*) into k from notifications where profile_id = F and type = 'paid' and title = 'Paid $230';
  r := r || format(E'\n%s paid → rep "Paid $230": %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  select count(*) into k from notification_emails where profile_id = F and type in ('paid', 'pay_problem');
  r := r || format(E'\n%s pay-week owns rep pay emails (none queued here): %s', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;

  -- 10. Invite accepted → admin.
  insert into rep_invites (id, token, role, created_by, invited_email, expires_at) values (inv, 'p767-' || inv, 'agent', M, 'new@example.com', now() + interval '1 day');
  update rep_invites set used_at = now(), used_by = A where id = inv;
  select count(*) into k from notifications where profile_id = M and type = 'invite_accepted' and detail = 'Accepted your invite';
  r := r || format(E'\n%s invite accepted → admin: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;

  -- 11. Call times: 5 minutes before, and not started.
  insert into policies (id, agent_id, client_first_name, client_last_name, status, fulfillment_assigned, assigned_fulfillment_id, scheduled_call_at, fulfillment_stage)
  values (pol3, A, 'Priya', 'Shah', 'In Effect', true, F, now() + interval '5 minutes', 'Pending');
  perform public.notify_call_times(); perform public.notify_call_times();
  select count(*) into k from notifications where profile_id = F and type = 'call_soon' and link like '%' || pol3;
  r := r || format(E'\n%s 5 minutes before, run twice → 1: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  perform public.notify_call_times(now() + interval '9 minutes');
  select count(*) into k from notifications where profile_id = F and type = 'call_not_started' and link like '%' || pol3;
  r := r || format(E'\n%s call time passed, not started → 1: %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;

  -- 12. Old-shape insert is dropped.
  insert into notifications (profile_id, type, message) values (A, 'new_team_member', 'X just joined the team');
  select count(*) into k from notifications where profile_id = A and type = 'new_team_member' and created_at >= now() - interval '1 second';
  r := r || format(E'\n%s old-shape insert dropped: %s', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;

  -- 13. RLS as the agent: own only, no writes, mark read own only.
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into k from notifications where profile_id <> A;
  r := r || format(E'\n%s agent reads others'' rows: %s', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  begin
    insert into notifications (profile_id, type, message, title) values (A, 'message', 'x', 'self-made');
    r := r || E'\nFAIL agent inserted own notification'; fails := fails + 1;
  exception when insufficient_privilege then r := r || E'\nPASS agent insert refused';
  end;
  begin
    update notifications set title = 'hacked' where profile_id = A;
    r := r || E'\nFAIL agent updated a notification'; fails := fails + 1;
  exception when insufficient_privilege then r := r || E'\nPASS agent update refused';
  end;
  begin
    perform public.notify(A, 'message', 'x', 'y', '/x');
    r := r || E'\nFAIL agent called notify()'; fails := fails + 1;
  exception when insufficient_privilege then r := r || E'\nPASS agent can''t call notify()';
  end;
  k := public.notifications_mark_read(null);
  execute 'reset role';
  select count(*) into k from notifications where profile_id = A and not read and title is not null;
  r := r || format(E'\n%s mark all read (agent left unread): %s', case when k = 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 0)::int;
  select count(*) into k from notifications where profile_id = M and not read and title is not null and created_at > now() - interval '1 minute';
  r := r || format(E'\n%s admin rows untouched (unread): %s', case when k > 0 then 'PASS' else 'FAIL' end, k); fails := fails + (k = 0)::int;

  -- 14. Quiet hours: 11 PM Central → 8 AM next day; money ignores it.
  r := r || format(E'\nINFO quiet 23:00 CT → %s ; money → %s',
    public.notify_send_after(M, false, timestamptz '2026-10-16 23:00 America/Chicago') at time zone 'America/Chicago',
    public.notify_send_after(M, true, timestamptz '2026-10-16 23:00 America/Chicago') at time zone 'America/Chicago');
  ok := public.notify_send_after(M, false, timestamptz '2026-10-16 23:00 America/Chicago') = timestamptz '2026-10-17 08:00 America/Chicago';
  r := r || format(E'\n%s quiet hours', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 15. 8 AM digest (only when something went wrong) and Monday summaries.
  update profiles set timezone = 'America/Chicago' where id in (A, M);
  -- Yesterday 8 AM: the four crons were failing in that window.
  perform public.notify_hourly(timestamptz '2026-10-15 08:10 America/Chicago');
  select count(*) into k from notification_emails where profile_id = M and type = 'daily_digest';
  r := r || format(E'\n%s 8 AM digest queued (crons failed in last 24h): %s', case when k = 1 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 1)::int;
  -- Next Monday 8 AM (nothing failed in that future window, so no digest).
  perform public.notify_hourly(timestamptz '2026-10-19 08:10 America/Chicago');
  select count(*) into k from notification_emails where type = 'monday_summary';
  r := r || format(E'\n%s Monday summaries (agent + admin): %s', case when k = 2 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 2)::int;
  perform public.notify_hourly(timestamptz '2026-10-19 08:40 America/Chicago');
  select count(*) into k from notification_emails where type in ('monday_summary', 'daily_digest');
  r := r || format(E'\n%s second run same hour → no dupes: %s', case when k = 3 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 3)::int;
  select count(*) into k from notifications where profile_id = A and type = 'needs_attention';
  r := r || format(E'\nINFO needs-attention items: %s', k);
  perform public.notify_hourly(timestamptz '2026-10-19 13:10 America/Chicago');
  select count(*) into k from notification_emails where type in ('monday_summary', 'daily_digest');
  r := r || format(E'\n%s not 8 AM → nothing: %s', case when k = 3 then 'PASS' else 'FAIL' end, k); fails := fails + (k <> 3)::int;

  raise exception 'P767 RESULTS (% failed):%', fails, r;
end $$;
