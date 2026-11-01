-- p_contact_log — pgTAP checks for NEXT_contact_log.sql: one read-only list of every
-- text and call that went to an agent's own client or lead.
--
-- RUN: at apply time, by the apply step, against the applied migration. No robot can
-- run SQL against Ohvara, and none did. Everything runs in one transaction that is
-- rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_contact_log.sql` replays every migration into an in-memory PGlite
-- and runs this file there. It has no database URL and can't reach Ohvara. A pass there
-- is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A and B (no upline link), U (A's upline), D (the demo side), I (an agent
-- with access off), rep R (Fulfillment), rep P (the old rep role), admin Z.
--
-- Every caller's rows go into the temp table seen, under a name, and the checks read
-- that as the table owner. p_cl_row prints one row with its ids as the names below, so
-- an expected value reads: subject|client_key|lead|policy|agent|time|channel|direction
-- |body|call_result|sender_type|sender_name|source|kind|attempts, with - for null.

begin;
create extension if not exists pgtap with schema extensions;
select plan(141);

-- ── helpers ─────────────────────────────────────────────────────────────────
create temp table ids (name text primary key, id uuid not null default gen_random_uuid());
create temp table keys (name text primary key, client_key text);
create temp table seen as select 0::bigint as n, ''::text as who, c.* from public.contact_log() c limit 0;
create temp sequence seen_n;
alter table seen alter column n set default nextval('seen_n');
grant all on ids, keys, seen to authenticated, anon;
grant all on seen_n to authenticated, anon;

-- The uuid behind a name, made the first time it's asked for. No name, no uuid.
create function public.p_cl_id(p_name text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  if p_name is null then
    return null;
  end if;
  insert into ids (name) values (p_name) on conflict (name) do nothing;
  select id into v from ids where name = p_name;
  return v;
end;
$f$;
grant execute on function public.p_cl_id(text) to authenticated, anon;

create function public.p_cl_claims(p_name text) returns text language sql as $f$
  select json_build_object('sub', public.p_cl_id(p_name), 'role', 'authenticated')::text
$f$;

-- Runs contact_log as this person and keeps what came back, in order.
create function public.p_cl_load(p_who text, p_name text, p_key text default null, p_lead uuid default null,
                                 p_before timestamptz default null, p_limit int default 1000)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', case when p_name is null then '' else public.p_cl_claims(p_name) end, true);
  perform set_config('role', 'authenticated', true);
  insert into seen (who, id, subject, client_key, lead_id, policy_id, agent_id, occurred_at, channel, direction,
                    body, call_result, sender_type, sender_name, source, kind, attempts)
  select p_who, c.* from public.contact_log(p_key, p_lead, p_before, p_limit) c;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$f$;

create function public.p_cl_name(p uuid) returns text language sql as $f$
  select case when p is null then '-' else coalesce((select i.name from ids i where i.id = p), p::text) end
$f$;

-- 'source:row' as contact_log writes it. A leg's row is its call_sid, not a name.
create function public.p_cl_rid(p_source text, p_row text) returns text language sql as $f$
  select p_source || ':' || coalesce((select i.id::text from ids i where i.name = p_row), p_row)
$f$;

create function public.p_cl_row(p_who text, p_source text, p_row text) returns text language sql as $f$
  select concat_ws('|', s.subject,
           case when s.client_key is null then '-'
                when s.client_key = (select v.client_key from public.policy_servicing_status v where v.policy_id = s.policy_id) then 'key'
                else 'WRONG' end,
           public.p_cl_name(s.lead_id), public.p_cl_name(s.policy_id), public.p_cl_name(s.agent_id),
           to_char(s.occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
           s.channel, s.direction, coalesce(s.body, '-'), coalesce(s.call_result, '-'), s.sender_type,
           coalesce(s.sender_name, '-'), s.source, coalesce(s.kind, '-'), coalesce(s.attempts::text, '-'))
    from seen s where s.who = p_who and s.id = public.p_cl_rid(p_source, p_row)
$f$;

create function public.p_cl_has(p_who text, p_source text, p_row text) returns bigint language sql as $f$
  select count(*) from seen s where s.who = p_who and s.id = public.p_cl_rid(p_source, p_row)
$f$;

create function public.p_cl_count(p_who text) returns bigint language sql as $f$
  select count(*) from seen s where s.who = p_who
$f$;

-- Rows both callers got. Isolation is this being 0.
create function public.p_cl_shared(p_one text, p_two text) returns bigint language sql as $f$
  select count(*) from seen x join seen y on y.id = x.id where x.who = p_one and y.who = p_two
$f$;

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', public.p_cl_id(u.n), 'authenticated', 'authenticated',
       'p_contact_log_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values ('A', 'agent'), ('B', 'agent'), ('U', 'agent'), ('D', 'agent'), ('I', 'agent'),
               ('R', 'fulfillment'), ('P', 'agent'), ('Z', 'agent')) as u(n, role);
update public.profiles set role = 'admin' where id = public.p_cl_id('Z');
update public.profiles set role = 'rep' where id = public.p_cl_id('P');
update public.profiles set upline_id = public.p_cl_id('U') where id = public.p_cl_id('A');
update public.profiles set is_demo = true where id = public.p_cl_id('D');

-- Clients. pa and pa_same are one person on two policies; pa_other is someone else in
-- A's book; pa_noview never went to Fulfillment, so it isn't in the status view.
insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                             fulfillment_assigned, fulfillment_stage, replaced_old_policy, assigned_fulfillment_id)
select public.p_cl_id(v.name), public.p_cl_id(v.agent), v.first, v.last, v.phone, 'In Effect', current_date - 100,
       v.assigned, case when v.assigned then 'Pending'::public.fulfillment_stage_status end,
       case when v.name <> 'pa' then false end,
       case when v.name = 'pa' then public.p_cl_id('R') end
  from (values
    ('pa',       'A', 'Ann',   'Alpha', '5125550101', true),
    ('pa_same',  'A', 'ann',   'ALPHA', '+15125550101', true),
    ('pa_other', 'A', 'Otto',  'Other', '5125550102', true),
    ('pa_noview','A', 'Nia',   'Noview', '5125550103', false),
    ('pb',       'B', 'Bea',   'Beta',  '5125550104', true),
    ('pu',       'U', 'Una',   'Upper', '5125550105', true),
    ('pd',       'D', 'Dee',   'Demo',  '5125550106', true),
    ('pi',       'I', 'Ivy',   'Inact', '5125550107', true)
  ) as v(name, agent, first, last, phone, assigned);

-- A demo policy in A's own name, so only the demo line can hide it from A.
update public.profiles set is_demo = true where id = public.p_cl_id('A');
insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                             fulfillment_assigned, fulfillment_stage, replaced_old_policy)
values (public.p_cl_id('pa_demo'), public.p_cl_id('A'), 'Dora', 'Sample', '5125550108', 'In Effect', current_date - 100, true, 'Pending', false);
update public.profiles set is_demo = false where id = public.p_cl_id('A');

-- Leads.
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id, transfer_agent_id,
                          transfer_status, va_outcome, va_attempts, va_last_worked_by, va_last_worked_at, client_policy_id)
select public.p_cl_id(v.name), v.name, v.name, '+1512555' || v.ph, 'TX', v.type,
       public.p_cl_id(v.assigned), public.p_cl_id(v.transfer),
       v.tstatus, v.outcome, coalesce(v.attempts, 0),
       public.p_cl_id(v.by_name), v.worked::timestamptz, public.p_cl_id(v.policy)
  from (values
    ('la',        '0201', 'mortgage_protection', 'A',  null, 'requested', 'not_reached', 3,    'R',  '2026-10-01 10:20:00+00', null),
    ('la_sold',   '0202', 'mortgage_protection', 'A',  null, null,        null,          null, null, null,                     'pa'),
    ('la_transfer','0203','policy_help',         null, 'A',  null,        null,          null, null, null,                     null),
    ('lb_assigned','0204','policy_help',         'B',  'A',  null,        null,          null, null, null,                     null),
    ('la_cancel', '0205', 'cancellation',        'A',  null, null,        'not_reached', 1,    'R',  '2026-10-01 11:00:00+00', null),
    ('la_vanull', '0206', 'policy_help',         'A',  null, null,        null,          null, 'R',  '2026-10-01 11:01:00+00', null),
    ('la_vanoat', '0207', 'policy_help',         'A',  null, null,        'callback',    1,    'R',  null,                     null),
    ('la_vaauto', '0208', 'policy_help',         'A',  null, null,        'callback',    1,    null, '2026-10-01 11:02:00+00', null),
    ('lb',        '0209', 'mortgage_protection', 'B',  null, null,        null,          null, null, null,                     null),
    ('lu',        '0210', 'mortgage_protection', 'U',  null, null,        null,          null, null, null,                     null),
    ('ld',        '0211', 'mortgage_protection', 'D',  null, null,        null,          null, null, null,                     null),
    ('li',        '0212', 'mortgage_protection', 'I',  null, null,        null,          null, null, null,                     null)
  ) as v(name, ph, type, assigned, transfer, tstatus, outcome, attempts, by_name, worked, policy);

-- Each source's rows for A, one a minute from 10:01, then what must stay hidden.
-- 1. lead_followup_sms_log
insert into public.lead_followup_sms_log (id, lead_id, stage, status, created_at) values
  (public.p_cl_id('r_followup'), public.p_cl_id('la'), 'just_submitted', 'sent',         '2026-10-01 10:01:00+00'),
  (public.p_cl_id('h_fu_gate'),  public.p_cl_id('la'), 'not_reached',    'skipped_gate', '2026-10-01 12:00:00+00'),
  (public.p_cl_id('h_fu_fail'),  public.p_cl_id('la'), 'reached',        'failed',       '2026-10-01 12:01:00+00'),
  (public.p_cl_id('h_fu_cancel'),public.p_cl_id('la_cancel'), 'just_submitted', 'sent',  '2026-10-01 11:03:00+00');

-- 2. lead_sms_replies. The number and the trailing spaces stay as stored.
insert into public.lead_sms_replies (id, from_phone, body, twilio_sid, lead_id, received_at) values
  (public.p_cl_id('r_reply'),    '+15125550201', 'Call me at 512-555-0199 after 5  ', 'SM_reply',    public.p_cl_id('la'),      '2026-10-01 10:02:00+00'),
  (public.p_cl_id('h_reply_nolead'), '+15125559999', 'Who is this?',                 'SM_nolead',   null,                      '2026-10-01 12:02:00+00'),
  (public.p_cl_id('h_reply_cancel'), '+15125550205', 'Cancel lead reply',            'SM_cancel',   public.p_cl_id('la_cancel'), '2026-10-01 11:04:00+00'),
  (public.p_cl_id('r_sold_reply'),   '+15125550202', 'Sold lead reply',              'SM_sold',     public.p_cl_id('la_sold'), '2026-10-01 10:30:00+00'),
  (public.p_cl_id('r_transfer_reply'), '+15125550203', 'Transfer reply',             'SM_transfer', public.p_cl_id('la_transfer'), '2026-10-01 10:31:00+00'),
  (public.p_cl_id('r_b_assigned_reply'), '+15125550204', 'Assigned wins',            'SM_assigned', public.p_cl_id('lb_assigned'), '2026-10-01 10:32:00+00'),
  (public.p_cl_id('r_b_reply'),  '+15125550209', 'B words', 'SM_b', public.p_cl_id('lb'), '2026-10-01 10:33:00+00'),
  (public.p_cl_id('r_u_reply'),  '+15125550210', 'U words', 'SM_u', public.p_cl_id('lu'), '2026-10-01 10:34:00+00'),
  (public.p_cl_id('r_d_reply'),  '+15125550211', 'D words', 'SM_d', public.p_cl_id('ld'), '2026-10-01 10:35:00+00'),
  (public.p_cl_id('r_i_reply'),  '+15125550212', 'I words', 'SM_i', public.p_cl_id('li'), '2026-10-01 10:36:00+00');

-- 3. inbound_events
insert into public.inbound_events (id, lead_id, agent_id, kind, state, at, label, detail) values
  (public.p_cl_id('r_inbound'), public.p_cl_id('la'), public.p_cl_id('A'), 'text_sent', 'done', '2026-10-01 10:03:00+00', 'Follow-up text, same day',
   '{"step":"not_reached_d0","seq":1,"summary":"Asks for a good time to talk."}'),
  (public.p_cl_id('r_inbound_rem'), public.p_cl_id('la'), public.p_cl_id('A'), 'reminder', 'done', '2026-10-01 10:04:00+00', 'Confirmation text',
   '{"step":"confirm","seq":1,"summary":"Confirms the appointment time."}'),
  (public.p_cl_id('h_ie_sched'), public.p_cl_id('la'), public.p_cl_id('A'), 'reminder', 'scheduled', '2026-10-01 12:03:00+00', 'Reminder text',
   '{"step":"reminder_1h","seq":1}'),
  (public.p_cl_id('h_ie_skip'), public.p_cl_id('la'), public.p_cl_id('A'), 'text_sent', 'skipped', '2026-10-01 12:04:00+00', 'Follow-up text, day 1',
   '{"step":"not_reached_d1","seq":1,"reason":"sms_off"}'),
  (public.p_cl_id('h_ie_nostep'), public.p_cl_id('la'), public.p_cl_id('A'), 'text_sent', 'done', '2026-10-01 12:05:00+00', 'A text with no step', '{}'),
  (public.p_cl_id('h_ie_stop'), public.p_cl_id('la'), public.p_cl_id('A'), 'follow_up', 'done', '2026-10-01 12:06:00+00', 'Follow-up texts stopped',
   '{"step":"stopped","seq":1}'),
  (public.p_cl_id('h_ie_cancel'), public.p_cl_id('la_cancel'), public.p_cl_id('A'), 'text_sent', 'done', '2026-10-01 11:05:00+00', 'x',
   '{"step":"instant","seq":1}');

-- 4. recovery_sms_log
insert into public.recovery_sms_log (id, policy_id, kind, ok, skipped, created_at) values
  (public.p_cl_id('r_recovery'),      public.p_cl_id('pa'),       'text1', true,  null,        '2026-10-01 10:05:00+00'),
  (public.p_cl_id('r_recovery_same'), public.p_cl_id('pa_same'),  'text2', true,  null,        '2026-10-01 10:37:00+00'),
  (public.p_cl_id('r_recovery_other'),public.p_cl_id('pa_other'), 'text1', true,  null,        '2026-10-01 10:38:00+00'),
  (public.p_cl_id('r_noview'),        public.p_cl_id('pa_noview'),'text1', true,  null,        '2026-10-01 10:39:00+00'),
  (public.p_cl_id('r_b_rec'),         public.p_cl_id('pb'),       'text1', true,  null,        '2026-10-01 10:40:00+00'),
  (public.p_cl_id('r_u_rec'),         public.p_cl_id('pu'),       'text1', true,  null,        '2026-10-01 10:41:00+00'),
  (public.p_cl_id('r_d_rec'),         public.p_cl_id('pd'),       'text1', true,  null,        '2026-10-01 10:42:00+00'),
  (public.p_cl_id('r_i_rec'),         public.p_cl_id('pi'),       'text1', true,  null,        '2026-10-01 10:43:00+00'),
  (public.p_cl_id('r_demo_in_a'),     public.p_cl_id('pa_demo'),  'text1', true,  null,        '2026-10-01 10:44:00+00'),
  (public.p_cl_id('h_rec_fail'),      public.p_cl_id('pa'),       'text2', false, null,        '2026-10-01 12:07:00+00'),
  (public.p_cl_id('h_rec_skip'),      public.p_cl_id('pa'),       'am',    false, 'no_consent','2026-10-01 12:08:00+00'),
  (public.p_cl_id('h_rec_okskip'),    public.p_cl_id('pa'),       'pm',    true,  'no_consent','2026-10-01 12:09:00+00');

-- 5. reminder_log. Each of the three times is different, so the wrong one shows.
insert into public.appointments (id, lead_id, scheduled_at) values
  (public.p_cl_id('appt_a'), public.p_cl_id('la'), '2026-10-02 15:00:00+00'),
  (public.p_cl_id('appt_cancel'), public.p_cl_id('la_cancel'), '2026-10-02 16:00:00+00');
insert into public.reminder_log (id, appointment_id, scheduled_time, send_time, status, channel, message_body, twilio_message_sid, error_message, created_at) values
  (public.p_cl_id('r_reminder'),  public.p_cl_id('appt_a'), '2026-10-01 10:00:00+00', '2026-10-01 10:06:00+00', 'sent', 'sms', 'See you at 3.', 'SM_rem', null, '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_pend'),  public.p_cl_id('appt_a'), '2026-10-01 12:10:00+00', null, 'pending', 'sms', 'pending words', null, null, '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_fail'),  public.p_cl_id('appt_a'), '2026-10-01 12:11:00+00', '2026-10-01 12:11:00+00', 'failed', 'sms', 'failed words', null, 'No phone number on lead', '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_cancel'),public.p_cl_id('appt_a'), '2026-10-01 12:12:00+00', null, 'cancelled', 'sms', 'cancelled words', null, null, '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_stub'),  public.p_cl_id('appt_a'), '2026-10-01 12:13:00+00', '2026-10-01 12:13:00+00', 'sent', 'sms', 'stub words', null, 'STUB: Twilio not configured', '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_email'), public.p_cl_id('appt_a'), '2026-10-01 12:14:00+00', '2026-10-01 12:14:00+00', 'sent', 'email', 'email words', 'SM_email', null, '2026-10-01 09:00:00+00'),
  (public.p_cl_id('h_rem_lead'),  public.p_cl_id('appt_cancel'), '2026-10-01 11:06:00+00', '2026-10-01 11:06:00+00', 'sent', 'sms', 'cancel lead words', 'SM_cl', null, '2026-10-01 09:00:00+00');

-- 6. calls, with a marker in everything that must never come back.
insert into public.calls (id, lead_id, rep_id, call_outcome, outcome, notes, call_notes, recording_url, twilio_recording_url, twilio_recording_sid,
                          transcript, grade, feedback_good, feedback_improve, twilio_call_sid, retell_call_id, created_at) values
  (public.p_cl_id('r_call_va'), public.p_cl_id('la'), public.p_cl_id('R'), 'no_answer', 'Voicemail',
   'MARKER_notes', 'MARKER_call_notes', 'MARKER_recording_url', 'MARKER_twilio_recording_url', 'MARKER_twilio_recording_sid',
   'MARKER_transcript', 'MARKER_grade', 'MARKER_feedback_good', 'MARKER_feedback_improve', 'MARKER_call_sid', 'MARKER_retell', '2026-10-01 10:07:00+00');
insert into public.calls (id, lead_id, rep_id, call_outcome, outcome, created_at) values
  (public.p_cl_id('r_call_agent'), public.p_cl_id('la'), public.p_cl_id('A'), null, 'No Answer', '2026-10-01 10:08:00+00'),
  (public.p_cl_id('r_call_rep'),   public.p_cl_id('la'), public.p_cl_id('P'), 'voicemail', null, '2026-10-01 10:09:00+00'),
  (public.p_cl_id('h_call_cancel'), public.p_cl_id('la_cancel'), public.p_cl_id('R'), 'no_answer', null, '2026-10-01 11:07:00+00');

-- 7. help_calls
insert into public.help_calls (id, call_sid, lead_id, status, outcome, created_at) values
  (public.p_cl_id('r_help'),        'CA_help1', public.p_cl_id('la'), 'ended',     'booked', '2026-10-01 10:10:00+00'),
  (public.p_cl_id('r_help_status'), 'CA_help2', public.p_cl_id('la'), 'no_answer', null,     '2026-10-01 10:11:00+00'),
  (public.p_cl_id('h_help_nolead'), 'CA_help3', null,                 'ended',     null,     '2026-10-01 12:15:00+00'),
  (public.p_cl_id('h_help_cancel'), 'CA_help4', public.p_cl_id('la_cancel'), 'ended', 'dropped', '2026-10-01 11:08:00+00');

-- 8. policy_events. pa also logged a real booked row of its own when it was inserted.
insert into public.policy_events (id, policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail, at) values
  (public.p_cl_id('r_ev_start'),  public.p_cl_id('pa'), public.p_cl_id('A'), 'in_progress', public.p_cl_id('R'), 'Rita Rep', 'fulfillment', '{"attempt":2}', '2026-10-01 10:12:00+00'),
  (public.p_cl_id('r_ev_result'), public.p_cl_id('pa'), public.p_cl_id('A'), 'no_answer',   public.p_cl_id('R'), 'Rita Rep', 'fulfillment', '{"attempt":2,"reason":null}', '2026-10-01 10:13:00+00'),
  (public.p_cl_id('r_ev_cancel'), public.p_cl_id('pa'), public.p_cl_id('A'), 'cancelled',   public.p_cl_id('Z'), 'Zed Admin', 'admin', '{"confirmation":"C1"}', '2026-10-01 10:14:00+00'),
  (public.p_cl_id('r_ev_agent'),  public.p_cl_id('pa'), public.p_cl_id('A'), 'in_progress', public.p_cl_id('A'), 'Amy Agent', 'agent', '{"attempt":3}', '2026-10-01 10:15:00+00'),
  (public.p_cl_id('r_ev_system'), public.p_cl_id('pa'), public.p_cl_id('A'), 'no_answer',   null, null, null, '{"attempt":3}', '2026-10-01 10:16:00+00'),
  (public.p_cl_id('h_ev_booked'), public.p_cl_id('pa'), public.p_cl_id('A'), 'booked',      null, null, null, '{}', '2026-10-01 12:16:00+00'),
  (public.p_cl_id('h_ev_moved'),  public.p_cl_id('pa'), public.p_cl_id('A'), 'moved',       null, null, null, '{}', '2026-10-01 12:17:00+00'),
  (public.p_cl_id('h_ev_correct'),public.p_cl_id('pa'), public.p_cl_id('A'), 'no_answer',   null, null, null, '{"correction":true,"from":"cancelled"}', '2026-10-01 12:18:00+00');

-- 9. fulfillment_voice_legs
insert into public.fulfillment_voice_legs (call_sid, policy_id, party, status, started_at, answered_at, end_reason) values
  ('CA_answered', public.p_cl_id('pa'), 'client',  'ended',   '2026-10-01 10:17:00+00', '2026-10-01 10:17:30+00', 'completed'),
  ('CA_missed',   public.p_cl_id('pa'), 'client',  'ended',   '2026-10-01 10:18:00+00', null, 'no-answer'),
  ('CA_ringing',  public.p_cl_id('pa'), 'client',  'ringing', '2026-10-01 10:19:00+00', null, null),
  ('CA_carrier',  public.p_cl_id('pa'), 'carrier', 'ended',   '2026-10-01 12:19:00+00', '2026-10-01 12:19:30+00', 'completed');

-- Two rows at one moment, for the id tie-break.
insert into public.lead_followup_sms_log (id, lead_id, stage, status, created_at) values
  (public.p_cl_id('r_tie_one'), public.p_cl_id('la_sold'), 'not_reached', 'sent', '2026-10-01 09:30:00+00'),
  (public.p_cl_id('r_tie_two'), public.p_cl_id('la_sold'), 'reached',     'sent', '2026-10-01 09:30:00+00');

update public.profiles set is_active = false where id = public.p_cl_id('I');

-- Each caller's own key, read from agent_clients as that caller. No key is worked out here.
select set_config('request.jwt.claims', public.p_cl_claims('A'), true), set_config('role', 'authenticated', true);
insert into keys select 'a', client_key from public.agent_clients where client_last_name = 'ALPHA' or client_last_name = 'Alpha';
insert into keys select 'a_other', client_key from public.agent_clients where client_last_name = 'Other';
reset role;
select set_config('request.jwt.claims', public.p_cl_claims('B'), true), set_config('role', 'authenticated', true);
insert into keys select 'b', client_key from public.agent_clients where client_last_name = 'Beta';
reset role;
select set_config('request.jwt.claims', '', true);
select public.p_cl_load('a', 'A'), public.p_cl_load('b', 'B'), public.p_cl_load('u', 'U'), public.p_cl_load('d', 'D'),
       public.p_cl_load('i', 'I'), public.p_cl_load('r', 'R'), public.p_cl_load('p', 'P'), public.p_cl_load('z', 'Z'),
       public.p_cl_load('nobody', null);

-- ── a. One row per source ───────────────────────────────────────────────────
select is(public.p_cl_row('a', 'lead_followup_sms_log', 'r_followup'),
          'lead|-|la|-|A|2026-10-01 10:01|text|out|-|-|system|-|lead_followup_sms_log|just_submitted|-', 'a1 a sent follow-up text');
select is(public.p_cl_row('a', 'lead_sms_replies', 'r_reply'),
          'lead|-|la|-|A|2026-10-01 10:02|text|in|Call me at 512-555-0199 after 5  |-|lead|-|lead_sms_replies|-|-', 'a2 a reply, with its words exactly as stored');
select is(public.p_cl_row('a', 'inbound_events', 'r_inbound'),
          'lead|-|la|-|A|2026-10-01 10:03|text|out|-|-|system|-|inbound_events|not_reached_d0|-', 'a3 a done step, with detail.step as the kind');
select is(public.p_cl_row('a', 'inbound_events', 'r_inbound_rem'),
          'lead|-|la|-|A|2026-10-01 10:04|text|out|-|-|system|-|inbound_events|confirm|-', 'a4 a done reminder step');
select is(public.p_cl_row('a', 'recovery_sms_log', 'r_recovery'),
          'client|key|-|pa|A|2026-10-01 10:05|text|out|-|-|system|-|recovery_sms_log|text1|-', 'a5 a sent recovery text, on the client');
select is(public.p_cl_row('a', 'reminder_log', 'r_reminder'),
          'lead|-|la|-|A|2026-10-01 10:06|text|out|See you at 3.|-|system|-|reminder_log|-|-', 'a6 a sent reminder, at send_time, not created_at or scheduled_time');
select is(public.p_cl_row('a', 'calls', 'r_call_va'),
          'lead|-|la|-|A|2026-10-01 10:07|call|out|-|no_answer|va|Test R|calls|-|-', 'a7 a calls row: call_outcome wins, and a Fulfillment caller reads va');
select is(public.p_cl_row('a', 'calls', 'r_call_agent'),
          'lead|-|la|-|A|2026-10-01 10:08|call|out|-|No Answer|agent|Test A|calls|-|-', 'a8 outcome when there is no call_outcome, and an agent caller reads agent');
select is(public.p_cl_row('a', 'calls', 'r_call_rep'),
          'lead|-|la|-|A|2026-10-01 10:09|call|out|-|voicemail|agent|Test P|calls|-|-', 'a9 a caller on the old rep role reads agent');
select is(public.p_cl_row('a', 'help_calls', 'r_help'),
          'lead|-|la|-|A|2026-10-01 10:10|call|in|-|booked|lead|-|help_calls|-|-', 'a10 a help call: outcome wins');
select is(public.p_cl_row('a', 'help_calls', 'r_help_status'),
          'lead|-|la|-|A|2026-10-01 10:11|call|in|-|no_answer|lead|-|help_calls|-|-', 'a11 status when there is no outcome');
select is(public.p_cl_row('a', 'policy_events', 'r_ev_start'),
          'client|key|-|pa|A|2026-10-01 10:12|call|out|-|in_progress|va|Rita Rep|policy_events|in_progress|2', 'a12 a call start, with its attempt');
select is(public.p_cl_row('a', 'policy_events', 'r_ev_result'),
          'client|key|-|pa|A|2026-10-01 10:13|call|out|-|no_answer|va|Rita Rep|policy_events|no_answer|2', 'a13 its result, paired by the same attempt');
select is(public.p_cl_row('a', 'policy_events', 'r_ev_cancel'),
          'client|key|-|pa|A|2026-10-01 10:14|call|out|-|cancelled|va|Zed Admin|policy_events|cancelled|-', 'a14 cancelled, and an admin actor reads va');
select is(public.p_cl_row('a', 'policy_events', 'r_ev_agent'),
          'client|key|-|pa|A|2026-10-01 10:15|call|out|-|in_progress|agent|Amy Agent|policy_events|in_progress|3', 'a15 an agent actor reads agent');
select is(public.p_cl_row('a', 'policy_events', 'r_ev_system'),
          'client|key|-|pa|A|2026-10-01 10:16|call|out|-|no_answer|system|-|policy_events|no_answer|3', 'a16 no person reads system');
select is(public.p_cl_row('a', 'fulfillment_voice_legs', 'CA_answered'),
          'client|key|-|pa|A|2026-10-01 10:17|call|out|-|answered|va|-|fulfillment_voice_legs|-|-', 'a17 an answered client leg reads answered, whatever its end_reason');
select is(public.p_cl_row('a', 'fulfillment_voice_legs', 'CA_missed'),
          'client|key|-|pa|A|2026-10-01 10:18|call|out|-|no-answer|va|-|fulfillment_voice_legs|-|-', 'a18 an unanswered leg reads its end_reason');
select is(public.p_cl_row('a', 'fulfillment_voice_legs', 'CA_ringing'),
          'client|key|-|pa|A|2026-10-01 10:19|call|out|-|ringing|va|-|fulfillment_voice_legs|-|-', 'a19 with no end_reason, its status');
select is(public.p_cl_row('a', 'leads.va_outcome', 'la'),
          'lead|-|la|-|A|2026-10-01 10:20|call|out|-|not_reached|va|Test R|leads.va_outcome|requested|3', 'a20 the leads VA columns, transfer_status as the kind, va_attempts as attempts');
select is(public.p_cl_row('a', 'leads.va_outcome', 'la_vaauto'),
          'lead|-|la_vaauto|-|A|2026-10-01 11:02|call|out|-|callback|system|-|leads.va_outcome|-|1', 'a21 VA columns with no person read system');
select is((select count(*) from seen where who = 'a' and id = 'fulfillment_voice_legs:CA_answered'), 1::bigint, 'a22 a leg''s id uses its call_sid');
select is((select count(*) from seen where who = 'a' and id = 'recovery_sms_log:' || public.p_cl_id('r_recovery')), 1::bigint, 'a23 an id is source:uuid');
select is((select count(distinct source) from seen where who = 'a'), 10::bigint, 'a24 all ten sources came back for A');
select is((select count(*) from seen where who = 'a' and subject = 'lead' and (client_key is not null or policy_id is not null or lead_id is null)), 0::bigint,
          'a25 a lead row has a lead_id and no client_key or policy_id');
select is((select count(*) from seen where who = 'a' and subject = 'client' and (lead_id is not null or policy_id is null)), 0::bigint,
          'a26 a client row has a policy_id and no lead_id');

-- ── b. Hidden rows ──────────────────────────────────────────────────────────
select is(public.p_cl_has('a', 'lead_followup_sms_log', 'h_fu_gate'), 0::bigint, 'b1 a skipped_gate follow-up is hidden');
select is(public.p_cl_has('a', 'lead_followup_sms_log', 'h_fu_fail'), 0::bigint, 'b2 a failed follow-up is hidden');
select is(public.p_cl_has('a', 'recovery_sms_log', 'h_rec_fail'), 0::bigint, 'b3 a recovery text with ok = false is hidden');
select is(public.p_cl_has('a', 'recovery_sms_log', 'h_rec_skip'), 0::bigint, 'b4 a skipped recovery text is hidden');
select is(public.p_cl_has('a', 'recovery_sms_log', 'h_rec_okskip'), 0::bigint, 'b5 skipped set hides it even with ok true');
select is(public.p_cl_has('a', 'reminder_log', 'h_rem_pend'), 0::bigint, 'b6 a pending reminder is hidden');
select is(public.p_cl_has('a', 'reminder_log', 'h_rem_fail'), 0::bigint, 'b7 a failed reminder is hidden');
select is(public.p_cl_has('a', 'reminder_log', 'h_rem_cancel'), 0::bigint, 'b8 a cancelled reminder is hidden');
select is(public.p_cl_has('a', 'reminder_log', 'h_rem_stub'), 0::bigint, 'b9 process-reminders'' stub row, sent with no sid, is hidden');
select is(public.p_cl_has('a', 'reminder_log', 'h_rem_email'), 0::bigint, 'b10 a reminder on another channel is hidden');
select is(public.p_cl_has('a', 'inbound_events', 'h_ie_sched'), 0::bigint, 'b11 a scheduled step is hidden');
select is(public.p_cl_has('a', 'inbound_events', 'h_ie_skip'), 0::bigint, 'b12 a skipped step is hidden');
select is(public.p_cl_has('a', 'inbound_events', 'h_ie_nostep'), 0::bigint, 'b13 a done row with no detail.step is hidden');
select is(public.p_cl_has('a', 'inbound_events', 'h_ie_stop'), 0::bigint, 'b14 a follow_up row with a step is hidden: the kind is not a text');
select is(public.p_cl_has('a', 'policy_events', 'h_ev_booked'), 0::bigint, 'b15 a booked event is hidden');
select is(public.p_cl_has('a', 'policy_events', 'h_ev_moved'), 0::bigint, 'b16 a moved event is hidden');
select is(public.p_cl_has('a', 'policy_events', 'h_ev_correct'), 0::bigint, 'b17 a correction is hidden');
select is(public.p_cl_has('z', 'lead_sms_replies', 'h_reply_nolead'), 0::bigint, 'b18 a reply with no lead reaches nobody, admin included');
select is(public.p_cl_has('z', 'help_calls', 'h_help_nolead'), 0::bigint, 'b19 a help call with no lead reaches nobody, admin included');
select is(public.p_cl_has('a', 'leads.va_outcome', 'la_vanull'), 0::bigint, 'b20 no va_outcome, no VA row');
select is(public.p_cl_has('a', 'leads.va_outcome', 'la_vanoat'), 0::bigint, 'b21 no va_last_worked_at, no VA row');
select is((select count(*) from seen where who = 'a' and occurred_at >= '2026-10-01 12:00:00+00'), 0::bigint,
          'b22 nothing from the hidden rows'' hour came back to A');

-- ── c. Traps ────────────────────────────────────────────────────────────────
select is(public.p_cl_has('a', 'fulfillment_voice_legs', 'CA_carrier'), 0::bigint, 'c1 a carrier leg is hidden');
select is(public.p_cl_has('a', 'fulfillment_voice_legs', 'CA_answered'), 1::bigint, 'c2 while the client leg on the same policy shows');
select is((select detail ->> 'summary' from public.inbound_events where id = public.p_cl_id('r_inbound')), 'Asks for a good time to talk.',
          'c3 the fixture has a detail.summary');
select is((select body from seen where who = 'a' and id = public.p_cl_rid('inbound_events', 'r_inbound')), null,
          'c4 inbound_events body is null with detail.summary and label set');
select is((select notes || call_notes || recording_url || twilio_recording_url || transcript || grade || feedback_good || feedback_improve
             from public.calls where id = public.p_cl_id('r_call_va')),
          'MARKER_notesMARKER_call_notesMARKER_recording_urlMARKER_twilio_recording_urlMARKER_transcriptMARKER_gradeMARKER_feedback_goodMARKER_feedback_improve',
          'c5 the fixture holds a marker in every field that must not leak');
select is((select count(*) from seen s where s.who in ('a', 'u', 'z') and s.source = 'calls'), 9::bigint, 'c6 and the calls row came back to each of A, U and Z');
select is((select count(*) from seen s where to_jsonb(s)::text like '%MARKER%'), 0::bigint, 'c7 no returned row anywhere holds a marker');
select is(pg_get_function_result('public.contact_log(text, uuid, timestamptz, int)'::regprocedure),
          'TABLE(id text, subject text, client_key text, lead_id uuid, policy_id uuid, agent_id uuid, occurred_at timestamp with time zone, channel text, direction text, body text, call_result text, sender_type text, sender_name text, source text, kind text, attempts integer)',
          'c8 the columns are exactly the contract''s');
select public.p_cl_load('a_cancel', 'A', null, public.p_cl_id('la_cancel'));
select is(public.p_cl_count('a_cancel'), 0::bigint, 'c9 a cancellation lead with its own rows returns nothing by id');
select is((select count(*) from seen where who in ('a', 'z', 'u') and lead_id = public.p_cl_id('la_cancel')), 0::bigint,
          'c10 or in A''s, U''s or the admin''s full list');
select is((select count(*) from seen where who in ('a', 'z') and occurred_at >= '2026-10-01 11:03:00+00' and occurred_at < '2026-10-01 11:09:00+00'), 0::bigint,
          'c11 none of the cancellation lead''s rows, of any source, came back');
select public.p_cl_load('a_sold', 'A', null, public.p_cl_id('la_sold'));
select is(public.p_cl_row('a_sold', 'lead_sms_replies', 'r_sold_reply'),
          'lead|-|la_sold|-|A|2026-10-01 10:30|text|in|Sold lead reply|-|lead|-|lead_sms_replies|-|-', 'c12 a Sold lead stays subject = lead with client_key null');
select is((select client_policy_id from public.leads where id = public.p_cl_id('la_sold')), public.p_cl_id('pa'), 'c13 the fixture points at the client''s policy');

-- ── d. Exact key ────────────────────────────────────────────────────────────
select isnt((select client_key from keys where name = 'a'), null, 'd1 A read the key from agent_clients');
select public.p_cl_load('a_key', 'A', (select client_key from keys where name = 'a'));
select is((select string_agg(id, ',' order by id) from seen where who = 'a_key'),
          (select string_agg(x, ',' order by x) from unnest(array[
             public.p_cl_rid('recovery_sms_log', 'r_recovery'), public.p_cl_rid('recovery_sms_log', 'r_recovery_same'),
             public.p_cl_rid('policy_events', 'r_ev_start'), public.p_cl_rid('policy_events', 'r_ev_result'),
             public.p_cl_rid('policy_events', 'r_ev_cancel'), public.p_cl_rid('policy_events', 'r_ev_agent'),
             public.p_cl_rid('policy_events', 'r_ev_system'), public.p_cl_rid('fulfillment_voice_legs', 'CA_answered'),
             public.p_cl_rid('fulfillment_voice_legs', 'CA_missed'), public.p_cl_rid('fulfillment_voice_legs', 'CA_ringing')
           ]) x),
          'd2 the key returns exactly that client''s rows, across both of their policies');
select is(public.p_cl_has('a_key', 'recovery_sms_log', 'r_recovery_other'), 0::bigint, 'd3 and no other client''s');
select is((select count(*) from seen where who = 'a_key' and client_key is distinct from (select client_key from keys where name = 'a')), 0::bigint,
          'd4 every row carries that key');
select is((select count(*) from seen where who = 'a_key' and subject = 'lead'), 0::bigint, 'd5 and no lead rows');
select is(public.p_cl_has('a_key', 'lead_sms_replies', 'r_sold_reply'), 0::bigint, 'd6 a Sold lead is absent under the key of its client_policy_id');
select is(public.p_cl_row('a', 'recovery_sms_log', 'r_noview'),
          'client|-|-|pa_noview|A|2026-10-01 10:39|text|out|-|-|system|-|recovery_sms_log|text1|-',
          'd7 a policy not in the status view keeps its row in the full list with client_key null');
select is((select count(*) from public.policy_servicing_status where policy_id = public.p_cl_id('pa_noview')), 0::bigint, 'd8 it really is not in the view');
select public.p_cl_load('a_badkey', 'A', 'not-a-key');
select is(public.p_cl_count('a_badkey'), 0::bigint, 'd9 a key that is no one''s returns nothing, without error');
select public.p_cl_load('a_lead', 'A', null, public.p_cl_id('la'));
select ok(public.p_cl_count('a_lead') > 0, 'd10 asking by lead returns its rows');
select is((select count(*) from seen where who = 'a_lead' and lead_id is distinct from public.p_cl_id('la')), 0::bigint, 'd11 and only that lead''s');

-- ── e. Isolation ────────────────────────────────────────────────────────────
select is(public.p_cl_row('b', 'lead_sms_replies', 'r_b_reply'),
          'lead|-|lb|-|B|2026-10-01 10:33|text|in|B words|-|lead|-|lead_sms_replies|-|-', 'e1 B sees B''s lead row');
select is(public.p_cl_has('b', 'recovery_sms_log', 'r_b_rec'), 1::bigint, 'e2 and B''s client row');
select is(public.p_cl_shared('a', 'b'), 0::bigint, 'e3 with no filter, A and B share no row');
select public.p_cl_load('b_by_a_key', 'B', (select client_key from keys where name = 'a')),
       public.p_cl_load('b_by_a_lead', 'B', null, public.p_cl_id('la')),
       public.p_cl_load('a_by_b_key', 'A', (select client_key from keys where name = 'b')),
       public.p_cl_load('a_by_b_lead', 'A', null, public.p_cl_id('lb'));
select is(public.p_cl_count('b_by_a_key'), 0::bigint, 'e4 B gets zero by A''s client_key');
select is(public.p_cl_count('b_by_a_lead'), 0::bigint, 'e5 B gets zero by A''s lead id');
select is(public.p_cl_count('a_by_b_key'), 0::bigint, 'e6 A gets zero by B''s client_key');
select is(public.p_cl_count('a_by_b_lead'), 0::bigint, 'e7 A gets zero by B''s lead id');
select is(public.p_cl_has('a', 'lead_sms_replies', 'r_transfer_reply'), 1::bigint, 'e8 with no assigned agent, the transfer agent''s lead shows');
select is(public.p_cl_has('a', 'lead_sms_replies', 'r_b_assigned_reply'), 0::bigint, 'e9 with both, the assigned agent decides: not A');
select is(public.p_cl_has('b', 'lead_sms_replies', 'r_b_assigned_reply'), 1::bigint, 'e10 but B');

-- ── f. Access ───────────────────────────────────────────────────────────────
select is(public.p_cl_has('u', 'recovery_sms_log', 'r_recovery'), 1::bigint, 'f1 U sees A''s client rows');
select is(public.p_cl_row('u', 'lead_sms_replies', 'r_reply'),
          'lead|-|la|-|A|2026-10-01 10:02|text|in|Call me at 512-555-0199 after 5  |-|lead|-|lead_sms_replies|-|-', 'f2 U sees A''s lead rows, words included');
select is(public.p_cl_has('u', 'lead_sms_replies', 'r_u_reply'), 1::bigint, 'f3 and their own');
select is(public.p_cl_has('a', 'lead_sms_replies', 'r_u_reply'), 0::bigint, 'f4 A sees none of U''s lead rows');
select is(public.p_cl_has('a', 'recovery_sms_log', 'r_u_rec'), 0::bigint, 'f5 or U''s client rows');
select is(public.p_cl_shared('u', 'b'), 0::bigint, 'f6 U shares no row with B');
select public.p_cl_load('u_by_a_key', 'U', (select client_key from keys where name = 'a'));
select is(public.p_cl_count('u_by_a_key'), 10::bigint, 'f7 U gets the same 10 rows by A''s client_key');
select is(public.p_cl_count('i'), 0::bigint, 'f8 an inactive agent with their own rows gets zero');
select is(public.p_cl_count('r'), 0::bigint, 'f9 a Fulfillment rep gets zero, even on a policy assigned to them');
select is((select assigned_fulfillment_id from public.policies where id = public.p_cl_id('pa')), public.p_cl_id('R'), 'f10 the fixture is assigned to R');
select is(public.p_cl_count('p'), 0::bigint, 'f11 the old rep role gets zero');
select is(public.p_cl_count('nobody'), 0::bigint, 'f12 a null auth.uid() gets zero');
select public.p_cl_load('r_by_lead', 'R', null, public.p_cl_id('la')), public.p_cl_load('i_by_lead', 'I', null, public.p_cl_id('li'));
select is(public.p_cl_count('r_by_lead') + public.p_cl_count('i_by_lead'), 0::bigint, 'f13 and neither gets anything by lead id');
select is((select count(*) from seen z where z.who = 'z'),
          (select count(distinct x.id) from seen x
            where x.who in ('a', 'b', 'u') or (x.who = 'd' and x.subject = 'lead'))
          + 2::bigint,
          'f14 admin sees every non-demo row: A''s, B''s, U''s, D''s leads and I''s two');
select is(public.p_cl_has('z', 'recovery_sms_log', 'r_i_rec') + public.p_cl_has('z', 'lead_sms_replies', 'r_i_reply'), 2::bigint, 'f15 those two are I''s');

-- ── g. Demo ─────────────────────────────────────────────────────────────────
select is((select is_demo from public.policies where id = public.p_cl_id('pa_demo')), true, 'g1 the fixture in A''s name is a demo policy');
select is(public.p_cl_has('d', 'recovery_sms_log', 'r_d_rec'), 1::bigint, 'g2 D sees D''s client rows');
select is(public.p_cl_shared('d', 'a'), 0::bigint, 'g3 and none of A''s');
select is(public.p_cl_has('a', 'recovery_sms_log', 'r_d_rec'), 0::bigint, 'g4 A does not see D''s client rows');
select is(public.p_cl_has('a', 'recovery_sms_log', 'r_demo_in_a'), 0::bigint, 'g5 A does not see a demo policy, even in their own name');
select is(public.p_cl_has('u', 'recovery_sms_log', 'r_demo_in_a'), 0::bigint, 'g6 nor does their upline');
select is(public.p_cl_has('z', 'recovery_sms_log', 'r_d_rec') + public.p_cl_has('z', 'recovery_sms_log', 'r_demo_in_a'), 0::bigint, 'g7 nor does a non-demo admin');
select is(public.p_cl_has('d', 'lead_sms_replies', 'r_d_reply'), 1::bigint, 'g8 D sees their own lead');
select is(public.p_cl_has('z', 'lead_sms_replies', 'r_d_reply'), 1::bigint, 'g9 and a lead on the demo agent is not walled: admin sees it');

-- ── h. Who may call it, and what it can do ──────────────────────────────────
select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select * from public.contact_log() $$, '42501', 'permission denied for function contact_log', 'h1 anon is refused');
reset role;
select ok(not has_function_privilege('anon', 'public.contact_log(text, uuid, timestamptz, int)', 'execute'), 'h2 anon has no execute');
select ok(not has_function_privilege('public', 'public.contact_log(text, uuid, timestamptz, int)', 'execute'), 'h3 public has no execute');
select ok(not has_function_privilege('service_role', 'public.contact_log(text, uuid, timestamptz, int)', 'execute'), 'h4 service_role has no execute');
select ok(has_function_privilege('authenticated', 'public.contact_log(text, uuid, timestamptz, int)', 'execute'), 'h5 authenticated does');
select is((select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure),
          'plpgsql'::name, 'h6 it is plpgsql');
select is((select prosecdef from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), true, 'h7 it is security definer');
select is((select provolatile::text from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), 's', 'h8 it is stable');
select ok((select proconfig @> array['search_path=public'] from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), 'h9 its search_path is set');
select ok((select prosrc !~* '\m(insert|update|delete|truncate|drop|alter)\M' from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), 'h10 its source has no write');
select ok((select prosrc !~* '(call_notes|recording|transcript|grade|feedback|\.notes)' from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), 'h11 its source never names a notes, recording or grade field');
select ok((select prosrc ~ 'p\.is_demo = \(select public\.my_is_demo\(\)\)' from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure), 'h12 the demo line is there');

select throws_ok($$ insert into public.contact_log (id) values ('x') $$, '42P01', null, 'h13 insert into public.contact_log fails for the owner');
select set_config('request.jwt.claims', public.p_cl_claims('A'), true), set_config('role', 'authenticated', true);
select throws_ok($$ insert into public.contact_log (id) values ('x') $$, '42P01', null, 'h14 and for an agent');
select throws_ok($$ select count(*) from public.lead_followup_sms_log $$, '42501', null, 'h15 A has no select on lead_followup_sms_log');
select throws_ok($$ select count(*) from public.recovery_sms_log $$, '42501', null, 'h16 A has no select on recovery_sms_log');
select throws_ok($$ select count(*) from public.lead_sms_replies $$, '42501', null, 'h17 A has no select on lead_sms_replies');
select throws_ok(format($$ select * from public.contact_log('k', %L) $$, public.p_cl_id('la')), '22023', 'Pass a client key or a lead, not both', 'h18 both filters raise 22023');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(not has_table_privilege('authenticated', 'public.lead_followup_sms_log', 'select')
          and not has_table_privilege('authenticated', 'public.recovery_sms_log', 'select')
          and not has_table_privilege('authenticated', 'public.lead_sms_replies', 'select'), 'h19 authenticated still has no select on the three log tables');
select is((select count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
            and tablename in ('lead_followup_sms_log', 'recovery_sms_log', 'lead_sms_replies')), 0::bigint, 'h20 and no policy that lets anyone read them');

-- ── i. Null bodies ──────────────────────────────────────────────────────────
select is((select count(*) from seen where who = 'a' and source in ('lead_followup_sms_log', 'inbound_events', 'recovery_sms_log')), 9::bigint,
          'i1 the three sources with no stored words returned their rows');
select is((select count(*) from seen where who = 'a' and source in ('lead_followup_sms_log', 'inbound_events', 'recovery_sms_log') and body is not null), 0::bigint,
          'i2 with a null body');
select is((select count(*) from seen where who = 'a' and channel = 'call' and (body is not null or call_result is null)), 0::bigint,
          'i3 a call has a result and no body');
select is((select count(*) from seen where who = 'a' and channel = 'text' and call_result is not null), 0::bigint, 'i4 a text has no result');
select is((select count(*) from seen where who = 'a' and channel = 'call' and direction not in ('in', 'out')), 0::bigint, 'i5 direction is in or out');

-- ── j. Order, limit, before ─────────────────────────────────────────────────
select is((select count(*) from (
             select occurred_at, id, lag(occurred_at) over w as prev_at, lag(id) over w as prev_id
               from seen where who = 'a' window w as (order by n)
           ) o where o.prev_at < o.occurred_at or (o.prev_at = o.occurred_at and o.prev_id < o.id)), 0::bigint,
          'j1 occurred_at desc, id desc');
select is((select count(*) from seen where who = 'a' and id in (public.p_cl_rid('lead_followup_sms_log', 'r_tie_one'), public.p_cl_rid('lead_followup_sms_log', 'r_tie_two'))), 2::bigint,
          'j2 the tie-break rows are both there');
select public.p_cl_load('a_before', 'A', null, null, '2026-10-01 10:05:00+00');
select ok(public.p_cl_count('a_before') > 0, 'j3 p_before returns earlier rows');
select is((select count(*) from seen where who = 'a_before' and occurred_at >= '2026-10-01 10:05:00+00'), 0::bigint, 'j4 and only rows strictly before it');

-- More rows than the cap, on a lead of B's.
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values (public.p_cl_id('lb_bulk'), 'Bulk', 'Bulk', '+15125550299', 'TX', 'policy_help', public.p_cl_id('B'));
insert into public.lead_sms_replies (from_phone, body, twilio_sid, lead_id, received_at)
select '+15125550299', 'bulk', 'SM_bulk_' || g, public.p_cl_id('lb_bulk'), '2026-10-05 10:00:00+00'::timestamptz + (g || ' seconds')::interval
  from generate_series(1, 1005) g;
select public.p_cl_load('b_null', 'B', null, null, null, null),
       public.p_cl_load('b_big', 'B', null, null, null, 5000),
       public.p_cl_load('b_two', 'B', null, null, null, 2),
       public.p_cl_load('b_zero', 'B', null, null, null, 0),
       public.p_cl_load('b_neg', 'B', null, null, null, -5);
select is(public.p_cl_count('b_null'), 200::bigint, 'j5 a null limit is 200');
select is(public.p_cl_count('b_big'), 1000::bigint, 'j6 the most is 1000');
select is(public.p_cl_count('b_two'), 2::bigint, 'j7 a limit of 2 is 2');
select is(public.p_cl_count('b_zero'), 0::bigint, 'j8 a limit of 0 is 0');
select is(public.p_cl_count('b_neg'), 0::bigint, 'j9 a negative limit is 0');
select set_config('request.jwt.claims', public.p_cl_claims('B'), true), set_config('role', 'authenticated', true);
select is((select count(*) from public.contact_log()), 200::bigint, 'j10 called with no arguments it returns 200');
reset role;

select * from finish();
rollback;
