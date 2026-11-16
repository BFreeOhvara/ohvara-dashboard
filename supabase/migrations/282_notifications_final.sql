-- P1023 — Notifications: exactly Brayden's lists, per role, nothing else (Nov 15).
--
-- Agent (8): live transfer, new appointment booked, appointment in 15 minutes, missed live transfer, rebooked,
--            client's payment failed, your payment failed, new message.
-- VA (12):   incoming call, new client to service, task due soon, client's payment failed (save call),
--            booked call in 5 minutes (and handed to you), booked call not started, message, client request,
--            shift in 15 minutes, missed clock-in or strike, pay sent, pay problem.
-- Admin (8): new agent ready for a campaign, agent's payment failed, new message, VA strike, VA pay problem,
--            something broke, bug report, time to hire.
--
-- Rules: push for anything time-sensitive; everything lands in the bell (the two ringing calls excepted: they
-- ring); email only for "Your payment failed" and "Something broke"; every notification links to its thing;
-- anyone can mute a non-urgent one (no phone alert, no email, still in the bell); live transfer, incoming call,
-- the payment-failed ones and booked-call-not-started can't be muted.
--
-- notification_types stays the one catalog: every type not on the lists stops firing (fires = false), and the
-- notifications_gate trigger now drops any row whose type doesn't fire, so old direct inserts stop too.

-- ── 1. Catalog ───────────────────────────────────────────────────────────────────────────────────────────────
alter table public.notification_types add column if not exists can_mute boolean not null default true;

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort, can_mute) values
  -- Agent
  ('live_transfer',         array['agent'],       'Live transfer',                       false, null,     false, true,  true,  true, 10, false),
  ('appointment_booked',    array['agent'],       'New appointment booked',              false, null,     true,  true,  false, true, 11, true),
  ('appointment_soon',      array['agent'],       'Appointment in 15 minutes',           false, null,     true,  true,  true,  true, 12, true),
  ('transfer_missed',       array['agent'],       'Missed live transfer',                false, null,     true,  true,  true,  true, 13, true),
  ('appointment_rebooked',  array['agent'],       'Rebooked on your calendar',           false, null,     true,  true,  false, true, 14, true),
  ('client_payment_failed', array['agent'],       'Client''s payment failed',            false, null,     true,  true,  true,  true, 15, false),
  -- VA
  ('new_client',            array['fulfillment'], 'New client to service',               false, null,     true,  true,  false, true, 21, true),
  ('task_due',              array['fulfillment'], 'Task due soon',                       false, null,     true,  true,  false, true, 22, true),
  ('va_save_call',          array['fulfillment'], 'Client''s payment failed: save call', false, null,     true,  true,  true,  true, 23, false),
  ('client_request',        array['fulfillment'], 'Client request',                      false, null,     true,  true,  false, true, 27, true),
  ('shift_soon',            array['fulfillment'], 'Shift starts in 15 minutes',          false, null,     true,  true,  true,  true, 28, true),
  -- Admin
  ('agent_ready',           array['admin'],       'New agent ready for a campaign',      false, null,     true,  true,  false, true, 40, true),
  ('bug_report',            array['admin'],       'Bug report',                          false, null,     true,  false, false, true, 45, true),
  ('time_to_hire',          array['admin'],       'Time to hire',                        false, null,     true,  false, false, true, 46, true)
on conflict (type) do update set roles = excluded.roles, label = excluded.label, email_default = excluded.email_default,
  email_via = excluded.email_via, in_bell = excluded.in_bell, push = excluded.push, money = excluded.money,
  fires = excluded.fires, sort = excluded.sort, can_mute = excluded.can_mute;

-- The types kept from before, in Brayden's words. money = true means "send now, even in quiet hours".
update public.notification_types t set label = v.label, roles = v.roles, sort = v.sort, push = v.push, in_bell = v.in_bell,
       money = v.money, can_mute = v.can_mute, email_via = v.email_via, email_default = v.email_default
  from (values
    ('billing_charge_failed',   array['agent'],                         'Your payment failed',            16, true,  true,  true,  false, 'notify', true),
    ('message',                 array['agent','fulfillment','admin'],   'New message',                    50, true,  true,  false, true,  null,     false),
    ('va_ring',                 array['fulfillment'],                   'Incoming call',                  20, true,  false, true,  false, null,     false),
    ('call_soon',               array['fulfillment'],                   'Booked call in 5 minutes',       24, true,  true,  true,  true,  null,     false),
    ('call_handed_to_you',      array['fulfillment'],                   'Booked call handed to you',      25, true,  true,  true,  true,  null,     false),
    ('call_not_started',        array['fulfillment'],                   'Booked call not started',        26, true,  true,  true,  false, null,     false),
    ('missed_strike',           array['fulfillment'],                   'Missed clock-in or strike',      29, true,  true,  false, true,  null,     false),
    ('paid',                    array['fulfillment'],                   'Pay sent',                       30, false, true,  false, true,  null,     false),
    ('pay_problem',             array['fulfillment'],                   'Pay problem',                    31, true,  true,  true,  true,  null,     false),
    ('billing_payment_problem', array['admin'],                         'Agent''s payment failed',        41, true,  true,  true,  false, null,     false),
    ('rep_strikes',             array['admin'],                         'VA strike',                      42, true,  true,  false, true,  null,     false),
    ('payout_problem',          array['admin'],                         'VA pay problem',                 43, true,  true,  true,  true,  null,     false),
    ('job_failed',              array['admin'],                         'Something broke',                44, true,  true,  false, true,  'notify', true)
  ) as v(type, roles, label, sort, push, in_bell, money, can_mute, email_via, email_default)
 where t.type = v.type;

update public.notification_types set fires = type = any (array[
  'live_transfer', 'appointment_booked', 'appointment_soon', 'transfer_missed', 'appointment_rebooked',
  'client_payment_failed', 'billing_charge_failed', 'message',
  'va_ring', 'new_client', 'task_due', 'va_save_call', 'call_soon', 'call_handed_to_you', 'call_not_started',
  'client_request', 'shift_soon', 'missed_strike', 'paid', 'pay_problem',
  'agent_ready', 'billing_payment_problem', 'rep_strikes', 'payout_problem', 'job_failed', 'bug_report', 'time_to_hire']);

-- Email only for the two: every other type stops emailing (pay-week's own payout emails included).
update public.notification_types set email_via = null where type not in ('billing_charge_failed', 'job_failed');
update public.profiles set payout_email_sent = false, payout_email_problem = false
 where role::text = 'fulfillment' and (coalesce(payout_email_sent, false) or coalesce(payout_email_problem, false));
alter table public.profiles alter column payout_email_sent set default false;
alter table public.profiles alter column payout_email_problem set default false;

-- ── 2. notify(): mute, and only firing types ─────────────────────────────────────────────────────────────────
create or replace function public.notify_muted(p_profile uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select t.can_mute from notification_types t where t.type = p_type), false)
     and coalesce((select (p.notification_prefs -> 'mute' ->> p_type)::boolean from profiles p where p.id = p_profile), false)
$$;

create or replace function public.notify(p_to uuid, p_type text, p_title text, p_detail text, p_link text,
  p_needs_action boolean default false, p_dedupe text default null, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t      notification_types;
  nid    uuid;
  v_demo boolean;
begin
  if p_to is null then return null; end if;
  select * into t from notification_types where type = p_type;
  if t.type is null then raise exception 'Unknown notification type %', p_type; end if;
  if not t.fires then return null; end if;
  select is_demo into v_demo from profiles where id = p_to and coalesce(is_active, true);
  if not found then return null; end if;
  if not coalesce(v_demo, false) and public.notify_from_demo(coalesce(p_data, '{}'::jsonb)) then return null; end if;
  insert into notifications (profile_id, type, message, title, detail, link, data, needs_action, dedupe_key, in_bell, push)
  values (p_to, p_type, p_title, p_title, p_detail, p_link, coalesce(p_data, '{}'::jsonb), p_needs_action, p_dedupe, t.in_bell, t.push)
  on conflict (profile_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into nid;
  if nid is not null and not public.notify_muted(p_to, p_type) then
    perform public.notify_queue_email(p_to, p_type, p_title, coalesce(p_detail, ''), p_link, 'n:' || nid::text, nid);
    perform public.notify_queue_push(p_to, p_type, nid, p_title, coalesce(p_detail, ''), p_link);
  end if;
  return nid;
end;
$$;

-- Old direct inserts (no title, or a type that no longer fires) never reach the table.
create or replace function public.notifications_gate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.title is null then return null; end if;
  if not exists (select 1 from notification_types t where t.type = new.type and t.fires) then return null; end if;
  return new;
end;
$$;

-- ── 3. Settings: the caller's list, and mute ─────────────────────────────────────────────────────────────────
create or replace function public.my_notification_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', t.type, 'label', t.label, 'push', t.push, 'bell', t.in_bell,
           'email', t.email_via is not null, 'email_on', coalesce(public.notify_email_on(p.id, t.type), false),
           'can_mute', t.can_mute, 'muted', public.notify_muted(p.id, t.type)) order by t.sort), '[]'::jsonb)
    from notification_types t join profiles p on p.id = auth.uid()
   where p.role::text = any (t.roles) and t.fires
$$;

create or replace function public.set_notification_mute(p_type text, p_muted boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t notification_types;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into t from notification_types where type = p_type and fires;
  if t.type is null or not exists (select 1 from profiles where id = auth.uid() and role::text = any (t.roles)) then
    raise exception 'Not a notification you get' using errcode = '22023';
  end if;
  if not t.can_mute then raise exception 'This one can''t be muted' using errcode = '22023'; end if;
  update profiles
     set notification_prefs = jsonb_set(coalesce(notification_prefs, '{}'::jsonb), '{mute}',
           coalesce(notification_prefs -> 'mute', '{}'::jsonb) || jsonb_build_object(p_type, coalesce(p_muted, false)))
   where id = auth.uid();
  return public.my_notification_list();
end;
$$;

-- ── 4. Helpers ───────────────────────────────────────────────────────────────────────────────────────────────
-- "Sarah Miller" → "Sarah M."
create or replace function public.notify_short(p_name text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when nullif(btrim(coalesce(p_name, '')), '') is null then 'A client'
    when position(' ' in btrim(p_name)) = 0 then btrim(p_name)
    else split_part(btrim(p_name), ' ', 1) || ' ' || upper(left(regexp_replace(btrim(p_name), '^.* ', ''), 1)) || '.'
  end
$$;

create or replace function public.notify_policy_short(p_policy uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.notify_short((select coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, '') from policies where id = p_policy))
$$;

-- "Tue 2:00 PM" in the reader's time zone; "today 2:00 PM" / "tomorrow 9:00 AM" when it is.
create or replace function public.notify_day_time(p_at timestamptz, p_profile uuid, p_now timestamptz default now())
returns text language sql stable security definer set search_path = public as $$
  select case (p_at at time zone public.notify_tz(p_profile))::date - (p_now at time zone public.notify_tz(p_profile))::date
           when 0 then 'today ' when 1 then 'tomorrow ' else to_char(p_at at time zone public.notify_tz(p_profile), 'Dy ') end
         || to_char(p_at at time zone public.notify_tz(p_profile), 'FMHH12:MI AM')
$$;

create or replace function public.notify_coverage_label(p_lead uuid, p_agent uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.label from leads l join coverage_types c on c.key = l.coverage_type where l.id = p_lead),
    (select c.label from coverage_types c where c.key = public.agent_coverage_of(p_agent)))
$$;

-- Who services a policy's client: its VA, else the VAs on shift now, else every active VA.
create or replace function public.notify_vas_for(p_policy uuid, p_now timestamptz default now())
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select coalesce(p.servicing_va_id, p.assigned_fulfillment_id) into v from policies p where p.id = p_policy;
  if v is not null and exists (select 1 from profiles where id = v and role::text = 'fulfillment' and coalesce(is_active, true)) then
    return next v; return;
  end if;
  return query select id from profiles where role::text = 'fulfillment' and coalesce(is_active, true)
                and coalesce(is_demo, false) = false and public.va_on_shift_at(id, p_now);
  if found then return; end if;
  return query select id from profiles where role::text = 'fulfillment' and coalesce(is_active, true) and coalesce(is_demo, false) = false;
end;
$$;

create or replace function public.notify_task_words(p_kind text, p_name text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_kind
    when 'address_change'     then 'Update ' || p_name || '''s address'
    when 'beneficiary_change' then 'Change ' || p_name || '''s beneficiary'
    when 'annual_review'      then 'Annual review with ' || p_name
    when 'chargeback_watch'   then 'Check ' || p_name || '''s payments'
    when 'lapse_save'         then 'Save call with ' || p_name
    when 'packet_check'       then 'Check ' || p_name || '''s policy packet'
    when 'review_call'        then 'Review call with ' || p_name
    when 'welcome_call'       then 'Welcome call with ' || p_name
    else initcap(replace(coalesce(p_kind, 'task'), '_', ' ')) || ' for ' || p_name end
$$;

-- ── 5. Agent: booked, missed transfer, rebooked ──────────────────────────────────────────────────────────────
-- One notification per appointment (dedupe appt:<lead>:<time>). A booking right after a transfer the agent
-- didn't take reads "You missed Sarah M.'s transfer"; a booking after a no-show or an earlier booking reads
-- "We rebooked"; anything else is "Booked".
create or replace function public.notify_appointment(p_lead uuid, p_agent uuid, p_at timestamptz, p_rebook boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name   text := public.notify_short((select contact_name from leads where id = p_lead));
  v_first  text := split_part(v_name, ' ', 1);
  v_cov    text := public.notify_coverage_label(p_lead, p_agent);
  v_when   text := public.notify_day_time(p_at, p_agent);
  v_key    text := 'appt:' || p_lead || ':' || extract(epoch from p_at)::bigint;
  v_link   text := '/agent/inbounds/' || p_lead;
  v_data   jsonb := jsonb_build_object('lead_id', p_lead);
begin
  if p_agent is null or p_at is null or p_at < now() then return null; end if;
  if exists (select 1 from transfer_checks c
              where c.lead_id = p_lead and not coalesce(c.is_test, false) and c.agent_id = p_agent
                and c.created_at > now() - interval '2 hours' and c.connected_at is null
                and c.answer is distinct from 'no') then
    return public.notify(p_agent, 'transfer_missed', 'You missed ' || v_name || '''s transfer',
      'We booked ' || v_first || ' for ' || v_when || '.', v_link, false, v_key, v_data);
  end if;
  if p_rebook or exists (select 1 from inbound_events e where e.lead_id = p_lead and e.kind in ('booked', 'rebooked', 'no_show')
                            and e.state is distinct from 'skipped' and e.created_at < now() - interval '1 second') then
    return public.notify(p_agent, 'appointment_rebooked', 'We rebooked ' || v_name || ' on your calendar: ' || v_when,
      coalesce(v_cov, 'New time on your calendar'), v_link, false, v_key, v_data);
  end if;
  return public.notify(p_agent, 'appointment_booked', 'Booked: ' || v_name || ', ' || v_when,
    coalesce(v_cov, 'New appointment'), v_link, false, v_key, v_data);
end;
$$;

create or replace function public.inbound_events_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if new.kind not in ('booked', 'rebooked') or new.agent_id is null or coalesce(new.is_sample, false)
     or new.state is not distinct from 'skipped' then return new; end if;
  begin
    v_at := coalesce((new.detail ->> 'appointment_at')::timestamptz, (new.detail ->> 'at')::timestamptz,
                     case when new.state = 'scheduled' then new.at end);
    -- "Rebooked" when this lead had an earlier booking or a no-show (the new row itself is excluded by time).
    perform public.notify_appointment(new.lead_id, new.agent_id, v_at,
      new.kind = 'rebooked' or exists (select 1 from inbound_events e where e.lead_id = new.lead_id and e.id <> new.id
                                        and e.kind in ('booked', 'rebooked', 'no_show') and e.state is distinct from 'skipped'
                                        and e.created_at <= new.created_at));
  exception when others then raise warning 'inbound_events_notify: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists inbound_events_notify on public.inbound_events;
create trigger inbound_events_notify after insert on public.inbound_events
  for each row execute function public.inbound_events_notify();

-- The VA booked a lead the agent didn't take (help-transfer action book).
create or replace function public.transfer_checks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'booked' and old.status is distinct from 'booked' and new.booked_for is not null
     and new.lead_id is not null and not coalesce(new.is_test, false) then
    begin
      perform public.notify_appointment(new.lead_id, new.agent_id, new.booked_for, false);
    exception when others then raise warning 'transfer_checks_notify: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists transfer_checks_notify on public.transfer_checks;
create trigger transfer_checks_notify after update of status on public.transfer_checks
  for each row execute function public.transfer_checks_notify();

-- ── 6. Client's payment failed: the agent hears it, a VA makes the save call ─────────────────────────────────
-- payment_missed_record() still writes its old payment_missed notice; that type no longer fires.
create or replace function public.payment_missed_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.notify_policy_short(new.policy_id);
  v_agent text := (select full_name from profiles where id = new.agent_id);
  v uuid;
begin
  begin
    perform public.notify(new.agent_id, 'client_payment_failed', v_name || '''s policy payment didn''t go through',
      'Our team is on it.', '/agent/clients/' || new.policy_id, false, 'clientpay:' || new.id,
      jsonb_build_object('policy_id', new.policy_id, 'event_id', new.id));
    for v in select * from public.notify_vas_for(new.policy_id) loop
      perform public.notify(v, 'va_save_call', v_name || '''s payment failed',
        'Save call needed' || coalesce(' by ' || public.notify_day_time(new.save_due_at, v), '')
          || coalesce(' · ' || nullif(btrim(v_agent), '') || '''s client', ''),
        '/fulfillment/pipeline/' || new.policy_id, true, 'save:' || new.id,
        jsonb_build_object('policy_id', new.policy_id, 'event_id', new.id));
    end loop;
  exception when others then raise warning 'payment_missed_notify: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists payment_missed_notify on public.payment_missed_events;
create trigger payment_missed_notify after insert on public.payment_missed_events
  for each row execute function public.payment_missed_notify();

-- ── 7. VA: new client, client request ────────────────────────────────────────────────────────────────────────
create or replace function public.servicing_tasks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name  text;
  v_agent text;
  v uuid;
begin
  if new.policy_id is null or coalesce(new.is_sample, false) then return new; end if;
  begin
    v_name  := public.notify_policy_short(new.policy_id);
    v_agent := nullif(btrim((select full_name from profiles where id = new.agent_id)), '');
    if new.kind = 'welcome_call' then
      -- Only the first welcome call: a retry after no answer isn't a new client.
      if exists (select 1 from servicing_tasks s where s.policy_id = new.policy_id and s.kind = 'welcome_call' and s.id <> new.id) then
        return new;
      end if;
      for v in select * from public.notify_vas_for(new.policy_id) loop
        perform public.notify(v, 'new_client', 'New client: ' || v_name || coalesce(' (' || v_agent || '''s)', ''),
          'Welcome call due ' || coalesce(public.notify_day_time(new.due_at, v), 'today'),
          '/fulfillment/pipeline/' || new.policy_id, true, 'newclient:' || new.policy_id,
          jsonb_build_object('policy_id', new.policy_id, 'task', new.id));
      end loop;
    elsif new.requested_by in ('agent', 'client') and new.kind <> 'lapse_save' then
      for v in select * from public.notify_vas_for(new.policy_id) loop
        perform public.notify(v, 'client_request', 'Client request: ' || public.notify_task_words(new.kind, v_name),
          case new.requested_by when 'client' then 'From the client' else 'From ' || coalesce(v_agent, 'the agent') end
            || coalesce(' · due ' || public.notify_day_time(new.due_at, v), ''),
          '/fulfillment/pipeline/' || new.policy_id, true, 'request:' || new.id,
          jsonb_build_object('policy_id', new.policy_id, 'task', new.id));
      end loop;
    end if;
  exception when others then raise warning 'servicing_tasks_notify: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists servicing_tasks_notify on public.servicing_tasks;
create trigger servicing_tasks_notify after insert on public.servicing_tasks
  for each row execute function public.servicing_tasks_notify();

-- The old "replacement ready" notice becomes a due task: "Cancel Sarah M.'s old policy, due today".
create or replace function public.replacement_mark(p_policy uuid, p_what text, p_on date, p_how text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p policies%rowtype; v_was boolean; v_va uuid;
begin
  if p_what is null or p_what not in ('issued', 'first_payment') then
    raise exception 'Mark issued or first_payment' using errcode = '22023';
  end if;
  select * into p from policies where id = p_policy for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if not (public.is_fulfillment() or public.is_admin() or (p.agent_id = auth.uid() and not public.is_fulfillment())) then
    raise exception 'Not your policy' using errcode = '42501';
  end if;
  if p_on is not null and (p_on > (now() at time zone 'America/Chicago')::date or p_on < current_date - 730) then
    raise exception 'Pick a date that has already happened' using errcode = '22023';
  end if;
  if p_what = 'first_payment' and p_on is not null and coalesce(p.new_issued_on, p_on) > p_on then
    raise exception 'The first payment can''t clear before the policy is issued' using errcode = '22023';
  end if;
  v_was := public.replacement_gate_closed(p);
  update policies
     set new_issued_on            = case when p_what = 'issued' then p_on else new_issued_on end,
         first_payment_cleared_on = case when p_what = 'first_payment' then p_on else first_payment_cleared_on end
   where id = p_policy
  returning * into p;
  perform public.doc_audit_add(p_policy, null, null, 'replacement_mark',
                               jsonb_build_object('what', p_what, 'on', p_on, 'how', left(p_how, 300)));
  if v_was and not public.replacement_gate_closed(p) then
    for v_va in select * from public.notify_vas_for(p_policy) loop
      perform public.notify(v_va, 'task_due',
        'Cancel ' || public.notify_policy_short(p_policy) || '''s old policy, due today',
        'The new policy is in force: issued ' || to_char(p.new_issued_on, 'Mon FMDD') || ', first payment cleared '
          || to_char(p.first_payment_cleared_on, 'Mon FMDD') || coalesce('. Old carrier: ' || p.carrier_name, '') || '.',
        '/fulfillment/pipeline/' || p_policy, true, 'replacement_ready:' || p_policy, jsonb_build_object('policy_id', p_policy));
    end loop;
  end if;
  return public.replacement_gate_state(p_policy);
end;
$$;

-- ── 8. The every-minute sweep: VA booked calls, agent appointments, tasks due, shifts ─────────────────────────
create or replace function public.notify_call_times(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  p policies;
  r record;
  n integer := 0;
  mins integer;
  v uuid;
begin
  -- VA: a booked call in 5 minutes.
  for p in
    select * from policies
     where fulfillment_assigned and assigned_fulfillment_id is not null
       and fulfillment_stage is distinct from 'Complete' and archived_at is null
       and scheduled_call_at > p_now + interval '3 minutes' and scheduled_call_at <= p_now + interval '6 minutes'
  loop
    if public.notify(p.assigned_fulfillment_id, 'call_soon', 'Call ' || public.notify_client(p) || ' in 5 minutes',
         public.notify_when(p.scheduled_call_at, p.assigned_fulfillment_id)
           || coalesce(' · ' || nullif(btrim(p.carrier_name), ''), '') || ' · Call client unlocks now',
         '/fulfillment/calendar/' || p.id, true,
         'soon:' || p.id || ':' || extract(epoch from p.scheduled_call_at)::bigint) is not null then
      n := n + 1;
    end if;
  end loop;
  -- VA: the booked call is 5 minutes late (it moves to another VA after that).
  for p in
    select * from policies
     where fulfillment_assigned and assigned_fulfillment_id is not null
       and fulfillment_stage is distinct from 'Complete' and archived_at is null
       and scheduled_call_at <= p_now - interval '5 minutes' and scheduled_call_at > p_now - interval '30 minutes'
       and call_live_since is null
       and (last_call_at is null or last_call_at < scheduled_call_at - interval '15 minutes')
  loop
    mins := floor(extract(epoch from (p_now - p.scheduled_call_at)) / 60);
    if public.notify(p.assigned_fulfillment_id, 'call_not_started',
         'Your ' || public.notify_when(p.scheduled_call_at, p.assigned_fulfillment_id) || ' call hasn’t started',
         public.notify_client(p) || ' · ' || mins || ' minutes late. Start it now or it moves to another VA.',
         '/fulfillment/calendar/' || p.id, true,
         'late:' || p.id || ':' || extract(epoch from p.scheduled_call_at)::bigint) is not null then
      n := n + 1;
    end if;
  end loop;
  -- Agent: an appointment in 15 minutes (the newest booking per lead, no no-show after it).
  for r in
    with newest as (
      select distinct on (e.lead_id) e.lead_id, e.agent_id, e.created_at,
             coalesce((e.detail ->> 'appointment_at')::timestamptz, (e.detail ->> 'at')::timestamptz,
                      case when e.state = 'scheduled' then e.at end) as at
        from inbound_events e
       where e.kind in ('booked', 'rebooked') and e.state is distinct from 'skipped' and not coalesce(e.is_sample, false)
         and e.agent_id is not null and e.created_at > p_now - interval '90 days'
       order by e.lead_id, e.created_at desc)
    select n0.* from newest n0 join leads l on l.id = n0.lead_id
     where n0.at > p_now + interval '5 minutes' and n0.at <= p_now + interval '15 minutes'
       and coalesce(l.inbound_stage, '') not in ('sold', 'lost')
       and not exists (select 1 from inbound_events x where x.lead_id = n0.lead_id and x.kind = 'no_show'
                         and x.state is distinct from 'skipped' and x.created_at > n0.created_at)
  loop
    mins := ceil(extract(epoch from (r.at - p_now)) / 60);
    if public.notify(r.agent_id, 'appointment_soon',
         'In ' || mins || ' minutes: ' || public.notify_short((select contact_name from leads where id = r.lead_id)),
         public.notify_when(r.at, r.agent_id) || coalesce(' · ' || public.notify_coverage_label(r.lead_id, r.agent_id), ''),
         '/agent/inbounds/' || r.lead_id, true, 'apptsoon:' || r.lead_id || ':' || extract(epoch from r.at)::bigint,
         jsonb_build_object('lead_id', r.lead_id)) is not null then
      n := n + 1;
    end if;
  end loop;
  -- VA: a servicing task due within 2 hours (the save call has its own notice).
  for r in
    select s.* from servicing_tasks s
     where s.status in ('requested', 'scheduled', 'in_progress') and s.kind <> 'lapse_save'
       and s.policy_id is not null and not coalesce(s.is_sample, false)
       and s.due_at > p_now and s.due_at <= p_now + interval '2 hours'
       and s.created_at < p_now - interval '2 hours' -- a new request already said when it's due
  loop
    for v in
      select r.va_claimed_by where r.va_claimed_by is not null and coalesce(r.va_claim_expires_at, 'infinity') > p_now
      union all
      select x from public.notify_vas_for(r.policy_id, p_now) x
       where r.va_claimed_by is null or coalesce(r.va_claim_expires_at, 'infinity') <= p_now
    loop
      if public.notify(v, 'task_due', public.notify_task_words(r.kind, public.notify_policy_short(r.policy_id))
             || ', due ' || public.notify_day_time(r.due_at, v, p_now),
           coalesce(nullif(btrim((select full_name from profiles where id = r.agent_id)), '') || '''s client', 'Servicing'),
           '/fulfillment/pipeline/' || r.policy_id, true, 'due:' || r.id,
           jsonb_build_object('policy_id', r.policy_id, 'task', r.id)) is not null then
        n := n + 1;
      end if;
    end loop;
  end loop;
  -- VA: a shift in 15 minutes, and a missed clock-in 10 minutes after the start.
  for r in
    select s.*, (s.shift_date + s.starts) at time zone s.tz as start_at from va_shifts s
     where s.shift_date between (p_now at time zone 'UTC')::date - 1 and (p_now at time zone 'UTC')::date + 1
       and not exists (select 1 from va_day_off_requests d where d.va_id = s.va_id and d.off_date = s.shift_date and d.status = 'approved')
  loop
    if r.start_at > p_now + interval '5 minutes' and r.start_at <= p_now + interval '15 minutes' then
      if public.notify(r.va_id, 'shift_soon', 'Your shift starts at ' || public.notify_when(r.start_at, r.va_id),
           'In ' || ceil(extract(epoch from (r.start_at - p_now)) / 60) || ' minutes. Clock in when you start.',
           '/fulfillment/schedule', false, 'shift:' || r.id || ':' || extract(epoch from r.start_at)::bigint) is not null then
        n := n + 1;
      end if;
    elsif r.start_at <= p_now - interval '10 minutes' and r.start_at > p_now - interval '30 minutes'
          and not exists (select 1 from va_presence vp where vp.user_id = r.va_id and vp.last_seen >= r.start_at) then
      if public.notify(r.va_id, 'missed_strike', 'You haven''t clocked in',
           'Your shift started at ' || public.notify_when(r.start_at, r.va_id) || '. Open the app and go Available.',
           '/fulfillment/schedule', true, 'clockin:' || r.id || ':' || extract(epoch from r.start_at)::bigint) is not null then
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

-- ── 9. Admin: new agent ready, bug report, something broke, time to hire ─────────────────────────────────────
-- Ready = the sign-up payment went through (pay is the last sign-up step).
create or replace function public.agent_ready_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_cov  text;
  a uuid;
begin
  if new.kind <> 'signup' or new.status <> 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'paid' then return new; end if;
  begin
    v_name := coalesce(nullif(btrim((select full_name from profiles where id = new.agent_id)), ''), 'A new agent');
    v_cov  := (select c.label from coverage_types c where c.key = public.agent_coverage_of(new.agent_id));
    for a in select * from public.notify_admins() loop
      perform public.notify(a, 'agent_ready', 'New agent ready: ' || v_name,
        'Launch ' || v_name || '''s ' || coalesce(v_cov, 'lead') || ' campaign', '/admin/setup', true,
        'ready:' || new.agent_id, jsonb_build_object('agent_id', new.agent_id));
    end loop;
  exception when others then raise warning 'agent_ready_notify: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists agent_ready_notify on public.lead_spend_charges;
create trigger agent_ready_notify after insert or update of status on public.lead_spend_charges
  for each row execute function public.agent_ready_notify();

create or replace function public.bug_reports_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid; v_who text;
begin
  v_who := coalesce(nullif(btrim((select full_name from profiles where id = new.reporter_id)), ''), 'a team member');
  for a in select * from public.notify_admins() loop
    perform public.notify(a, 'bug_report', 'Bug report from ' || v_who,
      left(regexp_replace(coalesce(new.description, ''), '\s+', ' ', 'g'), 140), '/admin/bugs', true,
      'bug:' || new.id, jsonb_build_object('bug_report_id', new.id));
  end loop;
  return new;
exception when others then raise warning 'bug_reports_notify: %', sqlerrm; return new;
end;
$$;

-- Plain words for a failed background job.
create or replace function public.job_words(p_job text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_job = 'notify-push'                then 'Phone alerts aren''t sending'
    when p_job = 'notify-email'               then 'Emails aren''t sending'
    when p_job = 'notify-call-times'          then 'Call reminders aren''t going out'
    when p_job like 'ai-caller%'              then 'The AI caller isn''t calling new leads'
    when p_job like 'route%'                  then 'Incoming calls aren''t being routed to VAs'
    when p_job like 'lead-spend%' or p_job like 'billing%' then 'Billing didn''t run'
    when p_job like 'transfer%'               then 'Live transfer checks aren''t running'
    when p_job like 'missed%'                 then 'Missed-call follow-up isn''t running'
    when p_job like 'lead-%' or p_job like 'process-lead%' then 'Lead handling didn''t run'
    when p_job like 'reactivation%'           then 'Reactivation calls didn''t run'
    when p_job like 'recovery%'               then 'Recovery texts didn''t send'
    when p_job like 'doc-send%'               then 'Forms to carriers aren''t sending'
    when p_job like 'licence%' or p_job like 'nipr%' then 'Licence checks didn''t run'
    else 'A background task (' || p_job || ') failed' end
$$;

create or replace function public.notify_job_failures(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, cron as $$
declare
  j  record;
  a  uuid;
  n  integer := 0;
begin
  for j in
    select jb.jobname, count(*) filter (where d.start_time > p_now - interval '10 minutes') recent, count(*) today
      from cron.job_run_details d join cron.job jb on jb.jobid = d.jobid
     where d.status = 'failed' and d.start_time > p_now - interval '24 hours'
     group by jb.jobname
    having count(*) filter (where d.start_time > p_now - interval '10 minutes') > 0
  loop
    for a in select * from public.notify_admins() loop
      if public.notify(a, 'job_failed', 'Something broke: ' || public.job_words(j.jobname),
           'It failed ' || j.today || ' time' || case when j.today = 1 then '' else 's' end || ' today (job ' || j.jobname || ').',
           '/admin', false, 'job:' || j.jobname || ':' || to_char(p_now at time zone public.notify_tz(a), 'YYYY-MM-DD')) is not null then
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;

-- Time to hire: booked servicing work in the next 7 days vs the hours on the VA rota.
alter table public.app_settings add column if not exists capacity_settings jsonb not null
  default '{"task_minutes": 20, "call_minutes": 30, "usable_share": 0.75, "hours_per_va": 40}'::jsonb;

create or replace function public.va_capacity_forecast(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg     jsonb := coalesce((select capacity_settings from app_settings where id = 1), '{}'::jsonb);
  d0      date := (p_now at time zone 'America/Chicago')::date + 1;
  d1      date := d0 + 6;
  v_tasks int;
  v_calls int;
  v_need  numeric;
  v_have  numeric;
  v_vas   int;
  v_per   numeric;
  v_short int;
begin
  select count(*) into v_tasks from servicing_tasks s
   where s.status in ('requested', 'scheduled', 'in_progress') and not coalesce(s.is_sample, false)
     and (s.due_at at time zone 'America/Chicago')::date between d0 and d1;
  select count(*) into v_calls from policies p
   where p.fulfillment_assigned and p.archived_at is null and p.fulfillment_stage is distinct from 'Complete'
     and (p.scheduled_call_at at time zone 'America/Chicago')::date between d0 and d1;
  v_need := (v_tasks * coalesce((cfg ->> 'task_minutes')::numeric, 20) + v_calls * coalesce((cfg ->> 'call_minutes')::numeric, 30)) / 60.0;
  select coalesce(sum(extract(epoch from (s.ends - s.starts)) / 3600.0), 0), count(distinct s.va_id) into v_have, v_vas
    from va_shifts s join profiles p on p.id = s.va_id and coalesce(p.is_active, true)
   where s.shift_date between d0 and d1 and s.ends > s.starts
     and not exists (select 1 from va_day_off_requests d where d.va_id = s.va_id and d.off_date = s.shift_date and d.status = 'approved');
  v_per := case when v_vas > 0 then v_have / v_vas else coalesce((cfg ->> 'hours_per_va')::numeric, 40) end;
  v_short := case when v_need > v_have * coalesce((cfg ->> 'usable_share')::numeric, 0.75)
                  then ceil((v_need - v_have * coalesce((cfg ->> 'usable_share')::numeric, 0.75)) / greatest(v_per * coalesce((cfg ->> 'usable_share')::numeric, 0.75), 1))
                  else 0 end;
  return jsonb_build_object('from', d0, 'to', d1, 'tasks', v_tasks, 'calls', v_calls, 'need_hours', round(v_need, 1),
                            'have_hours', round(v_have, 1), 'vas', v_vas, 'short_vas', v_short);
end;
$$;

create or replace function public.notify_time_to_hire(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  f jsonb := public.va_capacity_forecast(p_now);
  k int := (f ->> 'short_vas')::int;
  a uuid;
  n int := 0;
begin
  -- No rota yet (no shifts next week): nothing to compare against, so no notice.
  if k < 1 or coalesce((f ->> 'vas')::int, 0) = 0 then return 0; end if;
  for a in select * from public.notify_admins() loop
    if public.notify(a, 'time_to_hire',
         'Next week needs about ' || case k when 1 then 'one more VA' when 2 then 'two more VAs' when 3 then 'three more VAs' else k || ' more VAs' end,
         (f ->> 'need_hours') || ' hours of booked work, ' || (f ->> 'have_hours') || ' hours on the rota.',
         '/admin/fulfillment', false, 'hire:' || to_char(p_now at time zone 'America/Chicago', 'IYYY-IW'), f) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'time-to-hire';
    perform cron.schedule('time-to-hire', '0 14 * * *', 'select public.notify_time_to_hire()');
  end if;
exception when others then raise warning 'time-to-hire cron: %', sqlerrm;
end $$;

-- ── 10. Locks ────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.notify_muted(uuid, text) from public, anon, authenticated;
revoke execute on function public.notify(uuid, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;
revoke execute on function public.my_notification_list() from public, anon;
grant  execute on function public.my_notification_list() to authenticated;
revoke execute on function public.set_notification_mute(text, boolean) from public, anon;
grant  execute on function public.set_notification_mute(text, boolean) to authenticated;
revoke execute on function public.notify_short(text) from public, anon;
revoke execute on function public.notify_policy_short(uuid) from public, anon, authenticated;
revoke execute on function public.notify_day_time(timestamptz, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.notify_coverage_label(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.notify_vas_for(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.notify_task_words(text, text) from public, anon;
revoke execute on function public.notify_appointment(uuid, uuid, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.inbound_events_notify() from public, anon, authenticated;
revoke execute on function public.transfer_checks_notify() from public, anon, authenticated;
revoke execute on function public.payment_missed_notify() from public, anon, authenticated;
revoke execute on function public.servicing_tasks_notify() from public, anon, authenticated;
revoke execute on function public.agent_ready_notify() from public, anon, authenticated;
revoke execute on function public.bug_reports_notify() from public, anon, authenticated;
revoke execute on function public.job_words(text) from public, anon;
revoke execute on function public.notify_call_times(timestamptz) from public, anon, authenticated;
revoke execute on function public.notify_job_failures(timestamptz) from public, anon, authenticated;
revoke execute on function public.va_capacity_forecast(timestamptz) from public, anon, authenticated;
revoke execute on function public.notify_time_to_hire(timestamptz) from public, anon, authenticated;
