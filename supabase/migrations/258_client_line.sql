-- P924 — clients reach our team, not the agent.
--
--   1. VA pods: each Deedstone number gets 2–3 VAs (deedstone_number_vas), admin can change them.
--   2. A call in rings the VA who last talked with that caller (if free), then the number's pod, then any free VA.
--      Nobody takes it → the booked callback that already exists (P907). route_inbound gains p_to (the number
--      called); help-voice no longer rings the agent first (P916's inboundToAgent).
--   3. Client texts: client_text_intake reads the intent (cancel, payment, change, question), opens a pod task or a
--      save call, and drafts the automatic reply in client_text_replies. Nothing is sent from here: GoHighLevel sends
--      the reply once the workflow is wired (engine slot) and Brayden approves the wording.
--   4. "Still on the books?" is asked the day after the draft (check_delay_days 3 → 1).
--   5. The save call's new ends: to_agent (live transfer), agent_booked (on the agent's calendar), not_saved (the
--      client goes to Closed with the reason, policies.closed_reason).
--   6. One set of hours: the agent's working hours are their live-call hours too (agent_lead_product mode 'both').
--
-- Not applied: needs Brayden's yes.

-- ── 1. VA pods ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.deedstone_number_vas (
  number_id  uuid not null references public.deedstone_numbers(id) on delete cascade,
  va_id      uuid not null references public.profiles(id) on delete cascade,
  sort       smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (number_id, va_id)
);
alter table public.deedstone_number_vas enable row level security;
revoke all on public.deedstone_number_vas from public, anon, authenticated;
grant select on public.deedstone_number_vas to authenticated;
drop policy if exists deedstone_number_vas_read on public.deedstone_number_vas;
create policy deedstone_number_vas_read on public.deedstone_number_vas for select to authenticated
  using (public.is_admin() or va_id = auth.uid());

create or replace function public.admin_set_number_pod(p_number uuid, p_vas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := coalesce(array_length(p_vas, 1), 0); i int;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if n < 2 or n > 3 then raise exception 'A number needs 2 or 3 VAs' using errcode = '22023'; end if;
  if (select count(distinct v) from unnest(p_vas) v) <> n then raise exception 'A VA is listed twice' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_vas) v where not exists (select 1 from profiles p where p.id = v and p.role = 'fulfillment')) then
    raise exception 'Only VAs can be on a number' using errcode = '22023';
  end if;
  if not exists (select 1 from deedstone_numbers where id = p_number) then raise exception 'Number not found' using errcode = 'P0002'; end if;
  delete from deedstone_number_vas where number_id = p_number;
  for i in 1..n loop
    insert into deedstone_number_vas (number_id, va_id, sort) values (p_number, p_vas[i], i);
  end loop;
  return jsonb_build_object('ok', true, 'vas', to_jsonb(p_vas));
end; $$;
revoke all on function public.admin_set_number_pod(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_number_pod(uuid, uuid[]) to authenticated;

-- The order a call to p_to from p_caller rings: the VA who last took a call from this caller, then the pod.
create or replace function public.client_line_prefer(p_caller text, p_to text)
returns uuid[] language sql stable security definer set search_path = public as $$
  with last as (
    select q.taken_by as va from call_queue q
     where q.phone = public.sms_e164(p_caller) and q.taken_by is not null
     order by q.taken_at desc nulls last limit 1
  ), pod as (
    select v.va_id as va, v.sort from deedstone_number_vas v join deedstone_numbers n on n.id = v.number_id
     where n.phone = public.sms_e164(p_to) and n.active
  )
  select coalesce(array_agg(va order by o), '{}') from (
    select va, 0 as o from last
    union all select va, sort from pod where va not in (select va from last)
  ) x where va is not null;
$$;
revoke all on function public.client_line_prefer(text, text) from public, anon, authenticated;

-- ── 2. Calls in: last VA → pod → any free VA (236's route_offer whole, with the preferred tier added) ───────────
create or replace function public.route_offer(p_item uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare q public.call_queue; who uuid; pull boolean := false; pick uuid;
begin
  select * into q from public.call_queue where id = p_item and status = 'waiting' for update skip locked;
  if q.id is null then return null; end if;
  if q.kind = 'callback' and q.promiser_id is not null and not (q.promiser_id = any(q.missed_by || q.exclude)) then
    select p.user_id into who from public.va_presence p
     where p.user_id = q.promiser_id and p.status = 'available' and public.route_can_take(p);
  end if;
  -- P924: a client calling a Deedstone number rings the VA who last talked with them, then that number's pod.
  if who is null and q.kind = 'inbound' and jsonb_typeof(q.detail -> 'prefer') = 'array' then
    for pick in select (e.v #>> '{}')::uuid from jsonb_array_elements(q.detail -> 'prefer') with ordinality e(v, n) order by e.n loop
      select p.user_id into who from public.va_presence p
       where p.user_id = pick and p.status = 'available' and public.route_can_take(p)
         and not (p.user_id = any(q.missed_by || q.exclude))
       for update skip locked;
      exit when who is not null;
    end loop;
  end if;
  if who is null then
    select p.user_id into who from public.va_presence p
     where p.status = 'available' and public.route_can_take(p)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.idle_since asc nulls last, p.user_id
     limit 1 for update skip locked;
  end if;
  if who is null and q.kind in ('new_lead', 'inbound') then
    select p.user_id into who from public.va_presence p
     where p.status = 'on_hold_carrier' and public.route_can_take(p)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.since asc, p.user_id
     limit 1 for update skip locked;
    pull := who is not null;
  end if;
  if who is null then return null; end if;

  update public.call_queue
     set status = 'offered', offered_to = who, offered_at = now(), offer_expires_at = now() + interval '15 seconds',
         pull_hold = pull
   where id = q.id;
  update public.va_presence set status = case when pull then status else 'ringing' end, updated_at = now()
   where user_id = who;
  begin
    perform public.notify(who, 'va_ring',
      case q.kind when 'inbound' then 'Someone is calling in' when 'new_lead' then 'New lead: call now'
                  when 'callback' then 'Callback due now' when 'hold_handoff' then 'A carrier hold was handed to you'
                  else 'A dropped call needs you' end,
      coalesce(q.name, 'Answer in the portal'), '/fulfillment', true, 'ring:' || q.id::text,
      jsonb_build_object('queue_id', q.id, 'kind', q.kind));
  exception when others then raise warning 'va_ring notify: %', sqlerrm;
  end;
  return who;
end;
$$;
revoke all on function public.route_offer(uuid) from public, anon, authenticated;

drop function if exists public.route_inbound(text, text);
create or replace function public.route_inbound(p_call_sid text, p_caller text, p_to text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare lead uuid := public.lead_sms_match(p_caller); q uuid; nm text; st text; pref uuid[];
begin
  if lead is not null then
    update public.leads set call_consent_at = coalesce(call_consent_at, now()) where id = lead
    returning coalesce(contact_name, business_name), state into nm, st;
    update public.help_calls set lead_id = lead where call_sid = p_call_sid and lead_id is null;
  end if;
  pref := public.client_line_prefer(p_caller, p_to);
  q := public.route_enqueue('inbound', lead, p_phone => p_caller, p_state => st, p_name => coalesce(nm, 'Caller ending ' || right(public.sms_e164(p_caller), 4)),
                            p_help_sid => p_call_sid, p_detail => jsonb_build_object('prefer', to_jsonb(pref), 'to', public.sms_e164(p_to)),
                            p_offer => false);
  if q is not null and (select status from public.call_queue where id = q) = 'waiting' then perform public.route_offer(q); end if;
  return jsonb_build_object('queue_id', q, 'lead_id', lead, 'prefer', to_jsonb(pref),
    'offered', (select offered_to is not null from public.call_queue where id = q));
end;
$$;
revoke all on function public.route_inbound(text, text, text) from public, anon, authenticated;

-- ── 3. Client texts → a task or a save call, plus the drafted reply ────────────────────────────────────────────
create table if not exists public.client_text_replies (
  id          uuid primary key default gen_random_uuid(),
  message_id  text unique,
  policy_id   uuid references public.policies(id) on delete set null,
  task_id     uuid references public.servicing_tasks(id) on delete set null,
  to_phone    text not null,
  intent      text not null check (intent in ('cancel', 'payment', 'change', 'question')),
  body        text not null check (char_length(body) <= 320),
  status      text not null default 'drafted' check (status in ('drafted', 'sent', 'skipped')),
  created_at  timestamptz not null default now()
);
alter table public.client_text_replies enable row level security;
revoke all on public.client_text_replies from public, anon, authenticated;
grant select on public.client_text_replies to authenticated;
drop policy if exists client_text_replies_read on public.client_text_replies;
create policy client_text_replies_read on public.client_text_replies for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

-- Same rules as src/lib/clientLine.js textIntent (cancel → payment → change → question).
create or replace function public.client_text_intent(p_body text) returns text language sql immutable as $$
  select case
    when p_body ~* '\m(cancel|terminate)\M|stop (my|the) policy|don''?t want (it|the policy)|end (my|the) policy' then 'cancel'
    when p_body ~* '\m(pay|payment|payments|bank|card|draft|drafted|charge|charged|bounced|declined|bill|billed|billing|premium|late)\M|\mwithdraw' then 'payment'
    when p_body ~* '\m(change|update|address|moved|name)\M|beneficiar|new (phone|number|email)' then 'change'
    else 'question' end;
$$;

create or replace function public.client_text_intake(p_phone text, p_body text, p_message_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p policies; v_intent text := public.client_text_intent(coalesce(p_body, '')); v_kind text; v_task uuid;
  v_va text; v_due timestamptz; v_when text; v_reply text; v_open boolean;
begin
  select * into p from policies
   where public.sms_e164(client_phone) = public.sms_e164(p_phone) and closed_at is null and archived_at is null
   order by created_at desc limit 1;
  if p.id is null then return jsonb_build_object('ok', false, 'why', 'no client'); end if;
  if exists (select 1 from client_text_replies where message_id = p_message_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_kind := case v_intent when 'cancel' then 'lapse_save' when 'payment' then 'payment_change' else 'other' end;
  v_due := public.payment_save_deadline(now());
  insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, note)
  values (p.agent_id, p.id, v_kind, 'requested', v_due, 'client',
          case v_intent when 'cancel' then 'Texted asking to cancel. Call, find out why, and try to save it.'
                        when 'payment' then 'Texted about a payment problem. Call and fix it.'
                        when 'change' then 'Texted a change request: ' || left(p_body, 200)
                        else 'Texted a question: ' || left(p_body, 200) || ' Call them back.' end)
  returning id into v_task;

  -- The first VA on the pod of the agent's Deedstone number names the reply.
  select nullif(split_part(pr.full_name, ' ', 1), '') into v_va
    from deedstone_agent_lines l join deedstone_number_vas v on v.number_id = l.number_id join profiles pr on pr.id = v.va_id
   where l.agent_id = p.agent_id
   order by v.sort limit 1;
  v_open := extract(hour from now() at time zone 'America/Chicago') between 8 and 17;
  v_when := case when (v_due at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
                 then 'today' else 'tomorrow' end;
  v_reply := case when not v_open then 'Got it. Our care team is closed for the night. ' || coalesce(v_va, 'Our team') || ' will call you ' || v_when || '.'
                  when v_intent = 'change' then 'Got it. ' || coalesce(v_va, 'Our team') || ' from our care team is on it and will text or call you ' || v_when || ' if they need anything.'
                  else 'Got it. ' || coalesce(v_va, 'Our team') || ' from our care team will call you ' || v_when || '.' end;
  insert into client_text_replies (message_id, policy_id, task_id, to_phone, intent, body)
  values (p_message_id, p.id, v_task, public.sms_e164(p_phone), v_intent, v_reply);
  return jsonb_build_object('ok', true, 'intent', v_intent, 'task', v_task, 'reply', v_reply);
end; $$;
revoke all on function public.client_text_intake(text, text, text) from public, anon, authenticated;

-- ── 4. The check, the day after the draft ──────────────────────────────────────────────────────────────────────
alter table public.book_settings alter column check_delay_days set default 1;
update public.book_settings set check_delay_days = 1, updated_at = now() where check_delay_days = 3;

-- ── 5. The save call's new ends ────────────────────────────────────────────────────────────────────────────────
alter table public.policies add column if not exists closed_reason text check (closed_reason is null or char_length(closed_reason) <= 80);

alter table public.servicing_tasks drop constraint if exists servicing_tasks_outcome_check;
alter table public.servicing_tasks add constraint servicing_tasks_outcome_check check (
  outcome is null or case
    when kind = 'lapse_save' then outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed', 'to_agent', 'agent_booked', 'not_saved')
    when kind = 'packet_check' then outcome in ('delivered', 'not_delivered')
    when kind in ('review_call', 'annual_review', 'conversion') then outcome in ('completed', 'not_reached')
    when kind = 'chargeback_watch' then outcome in ('on_time', 'missed')
    when kind = 'welcome_call' then outcome in ('welcomed', 'details_fixed', 'problem', 'no_answer')
    when kind in ('beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
                  'claim_help', 'carrier_call', 'other') then outcome in ('completed', 'could_not_complete')
    else false
  end);

-- 243's version whole, with the P924 save-call ends allowed and the reason kept on a not_saved.
drop function if exists public.va_servicing_outcome(uuid, text);
create or replace function public.va_servicing_outcome(p_task uuid, p_outcome text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_task servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can record an outcome' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;

  v_task := public.servicing_task_for_write(p_task);
  if p_outcome is null or not (case
       when v_task.kind = 'lapse_save' then p_outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed', 'to_agent', 'agent_booked', 'not_saved')
       when v_task.kind = 'packet_check' then p_outcome in ('delivered', 'not_delivered')
       when v_task.kind in ('review_call', 'annual_review', 'conversion') then p_outcome in ('completed', 'not_reached')
       when v_task.kind = 'chargeback_watch' then p_outcome in ('on_time', 'missed')
       when v_task.kind = 'welcome_call' then p_outcome in ('welcomed', 'details_fixed', 'problem', 'no_answer')
       else p_outcome in ('completed', 'could_not_complete')
     end) then
    raise exception 'That outcome doesn''t fit this step' using errcode = '22023';
  end if;
  if p_outcome = 'not_saved' and nullif(btrim(p_reason), '') is null then
    raise exception 'Say why it can''t be saved' using errcode = '22023';
  end if;

  if p_outcome = 'not_saved' then
    update policies set closed_at = coalesce(closed_at, now()), closed_reason = left(btrim(p_reason), 80) where id = v_task.policy_id;
  end if;
  update servicing_tasks set outcome = p_outcome where id = p_task returning * into v_task;

  perform public.servicing_task_log(v_task, 'outcome');
  return v_task.outcome;
end;
$$;
revoke all on function public.va_servicing_outcome(uuid, text, text) from public, anon;
grant execute on function public.va_servicing_outcome(uuid, text, text) to authenticated;

-- The agent hears how the save call ended (to_agent / agent_booked / not_saved).
create or replace function public.client_save_told() returns trigger language plpgsql
security definer set search_path = public as $$
declare nm text;
begin
  if new.kind = 'lapse_save' and new.outcome in ('to_agent', 'agent_booked', 'not_saved') and old.outcome is distinct from new.outcome then
    select coalesce(trim(client_first_name || ' ' || coalesce(client_last_name, '')), 'A client') into nm from policies where id = new.policy_id;
    begin
      perform public.notify(new.agent_id, 'save_call',
        case new.outcome when 'to_agent' then 'Save call: ' || nm || ' is being transferred to you'
                         when 'agent_booked' then 'Save call: ' || nm || ' is booked on your calendar'
                         else 'Save call: ' || nm || ' can''t be saved' end,
        case new.outcome when 'not_saved' then 'Moved to Closed: ' || coalesce((select closed_reason from policies where id = new.policy_id), 'no reason')
                         else 'Our team found out why. See the client.' end,
        '/clients', false, 'save:' || new.id::text || ':' || new.outcome, jsonb_build_object('task', new.id));
    exception when others then raise warning 'save_call notify: %', sqlerrm;
    end;
  end if;
  return new;
end; $$;
drop trigger if exists p924_save_told on public.servicing_tasks;
create trigger p924_save_told after update of outcome on public.servicing_tasks
  for each row execute function public.client_save_told();

-- ── 6. One set of hours ────────────────────────────────────────────────────────────────────────────────────────
-- The agent's working hours (197) are their live-call hours too: agent_lead_product follows them, mode 'both'.
create or replace function public.agent_hours_to_live(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_object_agg(d.name, coalesce(
           (select jsonb_build_object('on', true, 'start', to_char(h.start_time, 'FMHH12:MI AM'), 'end', to_char(h.end_time, 'FMHH12:MI AM'))
              from agent_working_hours h where h.agent_id = p_agent and h.weekday = d.n),
           jsonb_build_object('on', false, 'start', '9:00 AM', 'end', '5:00 PM')))
    into v
    from unnest(array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) with ordinality d(name, n);
  insert into agent_lead_product (agent_id, mode, live_hours, updated_at) values (p_agent, 'both', v, now())
  on conflict (agent_id) do update set mode = 'both', live_hours = excluded.live_hours, updated_at = now();
end; $$;
revoke all on function public.agent_hours_to_live(uuid) from public, anon, authenticated;

create or replace function public.agent_hours_sync() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  perform public.agent_hours_to_live(coalesce(new.agent_id, old.agent_id));
  return null;
end; $$;
drop trigger if exists p924_hours_sync on public.agent_working_hours;
create trigger p924_hours_sync after insert or update or delete on public.agent_working_hours
  for each row execute function public.agent_hours_sync();

-- Existing agents with working hours: copy them over once.
do $$ declare a uuid;
begin
  for a in select distinct agent_id from public.agent_working_hours loop perform public.agent_hours_to_live(a); end loop;
end $$;
