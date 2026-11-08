-- p890_cleanup — pgTAP checks for p890_cleanup.sql: live-call hours replace the duty switch, Pause leads (spend
-- stops, no new leads, no weekly charge, resume from the next day), and the switched-off RPCs.
--
-- RUN: `npm run test:sql` (local PGlite) or `supabase test db` on a LOCAL stack only. One transaction, rolled back.
-- Never run it against Ohvara's live database.
--
-- Cast: agent A (both, Mon 9-5 Chicago), agent B (appointments only), VA V.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p890_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('f8900000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent'),
    ('f8900000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent'),
    ('f8900000-0000-4000-8000-00000000000f'::uuid, 'va_v',    'fulfillment')
  ) as u(id, n, role);
update public.profiles set is_active = true
 where id in ('f8900000-0000-4000-8000-00000000000a', 'f8900000-0000-4000-8000-00000000000b', 'f8900000-0000-4000-8000-00000000000f');

insert into public.agent_lead_product (agent_id, mode, live_hours, tz) values
  ('f8900000-0000-4000-8000-00000000000a', 'both', '{"Mon": {"on": true, "start": "9:00 AM", "end": "5:00 PM"}}', 'America/Chicago'),
  ('f8900000-0000-4000-8000-00000000000b', 'appts', '{"Mon": {"on": true, "start": "9:00 AM", "end": "5:00 PM"}}', 'America/Chicago')
on conflict (agent_id) do update set mode = excluded.mode, live_hours = excluded.live_hours, tz = excluded.tz;
insert into public.agent_lead_settings (agent_id, active, states) values
  ('f8900000-0000-4000-8000-00000000000a', true, '{TX}')
on conflict (agent_id) do update set active = true;

-- ── live-call hours (Mon Nov 9 2026: 15:00 UTC = 9:00 AM CT, 23:30 UTC = 5:30 PM CT) ─────────────────────
select is(public.clock_minutes('9:00 AM'), 540, 'clock_minutes reads 9:00 AM');
select is(public.clock_minutes('12:30 PM'), 750, 'clock_minutes reads 12:30 PM');
select ok(public.agent_live_now('f8900000-0000-4000-8000-00000000000a', '2026-11-09 15:00+00'), 'A is live at 9:00 AM CT Monday');
select ok(not public.agent_live_now('f8900000-0000-4000-8000-00000000000a', '2026-11-09 23:30+00'), 'A is not live at 5:30 PM CT');
select ok(not public.agent_live_now('f8900000-0000-4000-8000-00000000000a', '2026-11-10 15:00+00'), 'A is not live on Tuesday (no hours)');
select ok(not public.agent_live_now('f8900000-0000-4000-8000-00000000000b', '2026-11-09 15:00+00'), 'B (Appointments only) is never live');

-- ── switched off ──────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.fulfillment_decide_cancel(uuid, boolean, text)', 'execute'), 'no per-cancel decisions');
select ok(not has_function_privilege('service_role', 'public.credit_topup(uuid, integer, text, text, text)', 'execute'), 'old top-up cannot credit');
select ok(not has_table_privilege('authenticated', 'public.agent_duty', 'update'), 'nobody flips the duty switch');
select ok(has_function_privilege('authenticated', 'public.my_incoming_transfer()', 'execute'), 'incoming transfer check still callable');

-- ── Pause leads ───────────────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8900000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select throws_ok($$select public.lead_pause_set(null)$$, '42501', null, 'a VA cannot pause leads');
select set_config('request.jwt.claims', '{"sub":"f8900000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$select public.lead_pause_set(current_date - 2)$$, '22023', null, 'resume date must be after today');
select lives_ok($$select public.lead_pause_set(null)$$, 'A pauses with no resume date');
reset role;

select ok((select active from public.agent_lead_pause where agent_id = 'f8900000-0000-4000-8000-00000000000a'), 'pause row is active');
select ok(not (select active from public.agent_lead_settings where agent_id = 'f8900000-0000-4000-8000-00000000000a'), 'no new leads while paused');

insert into public.agent_campaign_control (agent_id, lead_type, run, daily_budget_cents, cap_cents, reason)
values ('f8900000-0000-4000-8000-00000000000a', 'appts', true, 5000, 20000, 'funded')
on conflict (agent_id, lead_type) do update set run = true, daily_budget_cents = 5000, cap_cents = 20000, reason = 'funded';
select results_eq($$select run, reason from public.agent_campaign_control where agent_id = 'f8900000-0000-4000-8000-00000000000a' and lead_type = 'appts'$$,
                  $$values (false, 'paused by agent'::text)$$, 'engine told to stop: paused by agent');

insert into public.lead_spend_charges (agent_id, week_start, kind, amount_cents, key)
values ('f8900000-0000-4000-8000-00000000000a', billing_week_of(billing_today()) + 7, 'weekly', 35000, 'p890-test-weekly');
select is((select count(*)::int from public.lead_spend_charges where key = 'p890-test-weekly'), 0, 'no weekly charge for a paused week');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8900000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.lead_pause_resume()$$, 'A resumes');
reset role;
select is((select resume_on from public.agent_lead_pause where agent_id = 'f8900000-0000-4000-8000-00000000000a'), billing_today() + 1, 'resume restarts from the next day');

-- The daily job on the resume day ends the pause and puts leads back on.
update public.agent_lead_pause set resume_on = billing_today() where agent_id = 'f8900000-0000-4000-8000-00000000000a';
select public.lead_pause_daily();
select ok((select active from public.agent_lead_settings where agent_id = 'f8900000-0000-4000-8000-00000000000a')
          and not (select active from public.agent_lead_pause where agent_id = 'f8900000-0000-4000-8000-00000000000a'),
          'resumed: leads back on, pause over');

select * from finish();
rollback;
