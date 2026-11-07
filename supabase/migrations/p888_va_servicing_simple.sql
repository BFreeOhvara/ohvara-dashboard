-- P888 — VA Servicing, kept simple: the missed-payment work runs itself (N-E-08, N-E-57).
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it after p885 (Parallel rule 4). Nothing is
-- dropped or emptied: the P885 tables, the forward address, the parsing and the Payment missed events all stay.
--
-- Brayden (Nov 7): VAs do two things, take the inbound call when the phone pops up and work the call tasks on
-- their schedule. So:
--   1. Weekly carrier portal checks are OFF. VAs don't log into carrier portals. The cron job is removed, open
--      checks are cancelled, and payment_portal_checks_seed() does nothing unless an admin turns
--      payment_settings.portal_checks_on back on (va_portal_check_done stays for that case).
--   2. Forwarded emails match themselves: policy number, then full name, then (new) last name when exactly one of
--      the agent's policies fits. What still can't be matched goes to the ADMINS (bell + Needs you), not to the
--      VAs. Matching or setting one aside by hand is admin-only now; the VA desk read no longer returns emails or
--      portal checks to a VA.
--   3. A missed payment is one ordinary lapse_save call task (P885 already opens it). Its results are now the four
--      a VA says on the phone: Saved / Fixing it / Wants to cancel / No answer ('lapsed' stays valid: the grace ran out).
--        saved            the miss closes as paid (as before)
--        client_cancelled the miss closes as cancelled (as before)
--        fixing           the miss stays open; a follow-up lapse_save "check it cleared" is due in 3 business days
--        no_answer        the miss stays open; the same call comes back the next business day, at most 3 tries
--                         in all and never past the grace end. After that the agent already has the warning.
--
-- Owed elsewhere (not built here): the agent-side one-minute forward setup and a "payment problem" choice in
-- Request service (P848); the admin Needs-you row for an unmatched email (P858 reads admin_payment_emails_to_match).

do $$
begin
  if to_regclass('public.payment_intake_emails') is null then raise exception 'p888 needs p885 applied first'; end if;
end $$;

-- ── 1. Carrier portal checks off ────────────────────────────────────────────
alter table public.payment_settings add column if not exists portal_checks_on boolean not null default false;
comment on column public.payment_settings.portal_checks_on is
  'P888: weekly carrier portal checks. Off: VAs don''t log into carrier portals. An admin can turn it back on.';
grant update (portal_checks_on) on public.payment_settings to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'payment-portal-checks';
  end if;
end $$;
update public.carrier_portal_checks set status = 'cancelled' where status = 'open';

create or replace function public.payment_portal_checks_seed() returns int language plpgsql
security definer set search_path = public as $$
declare v_days int; v_on boolean; v_n int;
begin
  select portal_check_days, portal_checks_on into v_days, v_on from payment_settings where id;
  if not coalesce(v_on, false) then return 0; end if;
  with books as (
    select p.agent_id, mode() within group (order by trim(p.carrier_name)) as carrier_name, count(*)::int as n
      from policies p join profiles a on a.id = p.agent_id
     where p.archived_at is null and coalesce(p.is_sample, false) = false and coalesce(p.is_demo, false) = false
       and p.status in ('Submitted', 'In Effect', 'Undrafted')
       and nullif(trim(p.carrier_name), '') is not null
       and a.role::text = 'agent' and coalesce(a.is_active, true)
     group by p.agent_id, lower(trim(p.carrier_name))
  ), due as (
    select b.* from books b
     where not exists (select 1 from carrier_portal_checks c
                        where c.agent_id = b.agent_id and lower(c.carrier_name) = lower(b.carrier_name)
                          and (c.status = 'open' or (c.status = 'done' and c.done_at > now() - make_interval(days => coalesce(v_days, 7)) + interval '12 hours')))
  ), ins as (
    insert into carrier_portal_checks (agent_id, carrier_name, policies_count, due_at)
    select agent_id, carrier_name, n, payment_save_deadline(now() - interval '1 day') from due
    on conflict do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end; $$;
revoke all on function public.payment_portal_checks_seed() from public, anon, authenticated;

-- ── 2. Forwarded emails: match by themselves; the rest go to the admins ─────
create or replace function public.payment_intake_receive(
  p_token text, p_message_id text, p_from text, p_subject text, p_body text, p_parsed jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent   uuid;
  v_intake  uuid;
  v_kind    text := coalesce(p_parsed->>'kind', 'other');
  v_number  text := payment_norm_policy(p_parsed->>'policy_number');
  v_client  text := lower(trim(regexp_replace(coalesce(p_parsed->>'client_name', ''), '\s+', ' ', 'g')));
  v_last    text;
  v_due     date;
  v_policy  uuid;
  v_hits    int := 0;
  v_why     text;
  v_event   uuid;
  v_status  text;
  r         record;
begin
  select agent_id into v_agent from payment_intake_addresses where token = lower(p_token);
  if v_agent is null then return jsonb_build_object('status', 'unknown_address'); end if;
  if v_kind not in ('missed', 'lapsed', 'paid', 'other') then v_kind := 'other'; end if;
  if coalesce(p_message_id, '') = '' then raise exception 'message_id is needed' using errcode = '22023'; end if;

  select id, status, event_id into r from payment_intake_emails where agent_id = v_agent and message_id = left(p_message_id, 300);
  if found then return jsonb_build_object('status', 'duplicate', 'intake_id', r.id, 'event_id', r.event_id); end if;

  begin v_due := (p_parsed->>'due_date')::date; exception when others then v_due := null; end;

  -- Match: the policy number first, then the insured's full name, then the last name alone (only when exactly one
  -- policy fits each time). "R. Ortiz" or "Policyholder: Ortiz" match when the agent has one Ortiz.
  if v_number is not null then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null and payment_norm_policy(policy_number) = v_number;
  end if;
  if coalesce(v_hits, 0) = 0 and v_client <> '' then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null
       and (lower(trim(coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, ''))) = v_client
         or lower(trim(coalesce(client_last_name, '') || ', ' || coalesce(client_first_name, ''))) = v_client);
    if coalesce(v_hits, 0) = 0 then
      v_last := case when v_client like '%,%' then trim(split_part(v_client, ',', 1))
                     else regexp_replace(v_client, '^.*\s', '') end;
      if length(v_last) >= 2 then
        select count(*), min(id::text)::uuid into v_hits, v_policy from policies
         where agent_id = v_agent and archived_at is null and lower(trim(coalesce(client_last_name, ''))) = v_last;
      end if;
    end if;
  end if;
  if coalesce(v_hits, 0) <> 1 then v_policy := null; end if;
  v_why := case when v_kind = 'other' then 'unclear' when coalesce(v_hits, 0) > 1 then 'several_policies'
                when v_policy is null then 'no_policy' end;

  v_status := case when v_kind = 'paid' then 'paid_notice'
                   when v_kind in ('missed', 'lapsed') and v_policy is not null then 'matched'
                   else 'unmatched' end;
  insert into payment_intake_emails (agent_id, message_id, from_addr, subject, body_excerpt, parsed, notice_kind, status,
                                     unmatched_why, policy_id)
  values (v_agent, left(p_message_id, 300), left(p_from, 300), left(p_subject, 500), left(p_body, 8000),
          coalesce(p_parsed, '{}'::jsonb), v_kind, v_status, case when v_status = 'unmatched' then v_why end, v_policy)
  returning id into v_intake;

  if v_status = 'matched' then
    v_event := payment_missed_record(v_policy, coalesce(v_due, (now() at time zone 'America/Chicago')::date), 'email',
                                     null, left(p_subject, 300), v_intake);
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'paid_notice' and v_policy is not null then
    update payment_missed_events set resolved_at = now(), resolution = 'paid'
     where policy_id = v_policy and resolved_at is null
     returning id into v_event;
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'unmatched' then
    -- P888: the admins, not the VAs.
    for r in select id from profiles where role::text = 'admin' and coalesce(is_active, true) loop
      perform public.notify(r.id, 'payment_intake_unmatched', 'A forwarded carrier email needs matching',
                            coalesce(left(p_subject, 140), 'No subject') || case v_why when 'several_policies' then ' (fits more than one policy)'
                              when 'unclear' then ' (not clear it''s a missed payment)' else ' (no policy found)' end,
                            '/admin', true, 'payment_intake:' || v_intake || ':' || r.id);
    end loop;
  end if;
  return jsonb_build_object('status', v_status, 'intake_id', v_intake, 'event_id', v_event, 'why', v_why);
end; $$;
revoke all on function public.payment_intake_receive(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_intake_receive(text, text, text, text, text, jsonb) to service_role;

update public.notification_types set roles = array['admin'] where type = 'payment_intake_unmatched';

create or replace function public.va_payment_intake_match(p_intake uuid, p_policy uuid, p_due date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e payment_intake_emails%rowtype; v_event uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can match an email' using errcode = '42501';
  end if;
  select * into e from payment_intake_emails where id = p_intake for update;
  if not found then raise exception 'Email not found' using errcode = 'P0002'; end if;
  if e.status <> 'unmatched' then raise exception 'This email is already handled' using errcode = '22023'; end if;
  if not exists (select 1 from policies where id = p_policy and agent_id = e.agent_id) then
    raise exception 'That policy isn''t this agent''s' using errcode = '42501';
  end if;
  v_event := payment_missed_record(p_policy,
               coalesce(p_due, (e.parsed->>'due_date')::date, (e.received_at at time zone 'America/Chicago')::date),
               'email', auth.uid(), left(e.subject, 300), p_intake);
  update payment_intake_emails set status = 'matched', unmatched_why = null, policy_id = p_policy, event_id = v_event,
         handled_by = auth.uid(), handled_at = now() where id = p_intake;
  return v_event;
end; $$;
revoke all on function public.va_payment_intake_match(uuid, uuid, date) from public, anon;
grant execute on function public.va_payment_intake_match(uuid, uuid, date) to authenticated;

create or replace function public.va_payment_intake_dismiss(p_intake uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can set an email aside' using errcode = '42501';
  end if;
  update payment_intake_emails set status = 'not_a_notice', handled_by = auth.uid(), handled_at = now()
   where id = p_intake and status = 'unmatched';
  if not found then raise exception 'Email not found or already handled' using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.va_payment_intake_dismiss(uuid) from public, anon;
grant execute on function public.va_payment_intake_dismiss(uuid) to authenticated;

-- The admin's Needs-you list: forwarded emails nothing could match, oldest first, with that agent's policies to pick.
create or replace function public.admin_payment_emails_to_match() returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can see this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'agent_id', e.agent_id, 'agent', a.full_name,
             'received_at', e.received_at, 'from', e.from_addr, 'subject', e.subject, 'excerpt', left(e.body_excerpt, 600),
             'parsed', e.parsed, 'why', e.unmatched_why) order by e.received_at)
          from payment_intake_emails e join profiles a on a.id = e.agent_id where e.status = 'unmatched'), '[]'::jsonb);
end; $$;
revoke all on function public.admin_payment_emails_to_match() from public, anon;
grant execute on function public.admin_payment_emails_to_match() to authenticated;

-- The open misses (VAs see them as their call tasks). Emails only for an admin; portal checks only while on.
create or replace function public.va_missed_payment_desk() returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare v_on boolean;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the missed-payment desk' using errcode = '42501';
  end if;
  select portal_checks_on into v_on from payment_settings where id;
  return jsonb_build_object(
    'emails', case when public.is_admin() then public.admin_payment_emails_to_match() else '[]'::jsonb end,
    'checks', case when coalesce(v_on, false) then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'agent_id', c.agent_id, 'agent', a.full_name,
                 'carrier', c.carrier_name, 'policies', c.policies_count, 'due_at', c.due_at) order by c.due_at)
              from carrier_portal_checks c join profiles a on a.id = c.agent_id where c.status = 'open'), '[]'::jsonb) else '[]'::jsonb end,
    'misses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'policy_id', m.policy_id, 'agent_id', m.agent_id,
                 'client', trim(coalesce(p.client_first_name, '') || ' ' || coalesce(p.client_last_name, '')),
                 'carrier', p.carrier_name, 'due_date', m.due_date, 'grace_ends_on', m.grace_ends_on,
                 'first_year', m.first_year, 'policy_month', m.policy_month, 'repeat', m.repeat_miss,
                 'task_id', m.lapse_task_id, 'save_due_at', m.save_due_at, 'sources', m.sources) order by m.save_due_at)
              from payment_missed_events m join policies p on p.id = m.policy_id where m.resolved_at is null), '[]'::jsonb));
end; $$;
revoke all on function public.va_missed_payment_desk() from public, anon;
grant execute on function public.va_missed_payment_desk() to authenticated;

-- ── 3. The save call's four results ─────────────────────────────────────────
alter table public.servicing_tasks drop constraint if exists servicing_tasks_outcome_check;
alter table public.servicing_tasks add constraint servicing_tasks_outcome_check check (
  outcome is null or case
    when kind = 'lapse_save' then outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed')
    when kind = 'packet_check' then outcome in ('delivered', 'not_delivered')
    when kind in ('review_call', 'annual_review', 'conversion') then outcome in ('completed', 'not_reached')
    when kind = 'chargeback_watch' then outcome in ('on_time', 'missed')
    when kind in ('beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
                  'claim_help', 'carrier_call', 'other') then outcome in ('completed', 'could_not_complete')
    else false
  end);
comment on column public.servicing_tasks.outcome is
  'How the step ended, one closed list per kind (206, P888). A lapse_save: saved, fixing, client_cancelled, no_answer (lapsed: history).';

create or replace function public.va_servicing_outcome(p_task uuid, p_outcome text)
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
       -- 'lapsed' stays accepted (the grace ran out) though the VA's picker shows the four call results.
       when v_task.kind = 'lapse_save' then p_outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed')
       when v_task.kind = 'packet_check' then p_outcome in ('delivered', 'not_delivered')
       when v_task.kind in ('review_call', 'annual_review', 'conversion') then p_outcome in ('completed', 'not_reached')
       when v_task.kind = 'chargeback_watch' then p_outcome in ('on_time', 'missed')
       else p_outcome in ('completed', 'could_not_complete')
     end) then
    raise exception 'That outcome doesn''t fit this step' using errcode = '22023';
  end if;

  update servicing_tasks set outcome = p_outcome where id = p_task returning * into v_task;

  perform public.servicing_task_log(v_task, 'outcome');
  return v_task.outcome;
end;
$$;
revoke all on function public.va_servicing_outcome(uuid, text) from public, anon;
grant execute on function public.va_servicing_outcome(uuid, text) to authenticated;

-- Fixing it / No answer keep the miss open and put the next call on the VA's schedule.
create or replace function public.payment_servicing_outcome() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  ev    payment_missed_events%rowtype;
  v_due timestamptz;
  v_n   int;
  v_new uuid;
begin
  if new.outcome is null or new.outcome is not distinct from old.outcome then return new; end if;
  if new.kind = 'chargeback_watch' and new.outcome = 'missed' and new.policy_id is not null then
    perform payment_missed_record(new.policy_id,
              coalesce((new.due_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date),
              'watch', auth.uid(), new.outcome_note);
  elsif new.kind = 'lapse_save' and new.outcome in ('saved', 'client_cancelled', 'lapsed') then
    update payment_missed_events
       set resolved_at = now(),
           resolution = case new.outcome when 'saved' then 'paid' when 'lapsed' then 'lapsed' else 'cancelled' end
     where lapse_task_id = new.id and resolved_at is null;
  elsif new.kind = 'lapse_save' and new.outcome in ('fixing', 'no_answer') then
    select * into ev from payment_missed_events where lapse_task_id = new.id and resolved_at is null;
    if not found then return new; end if;
    if new.outcome = 'fixing' then
      v_due := payment_save_deadline(payment_save_deadline(payment_save_deadline(now())));
    else
      select count(*) into v_n from servicing_tasks
       where policy_id = ev.policy_id and kind = 'lapse_save' and outcome = 'no_answer' and created_at >= ev.detected_at;
      v_due := payment_save_deadline(now());
      if v_n >= 3 or (ev.grace_ends_on is not null and (v_due at time zone 'America/Chicago')::date > ev.grace_ends_on) then
        return new;
      end if;
    end if;
    insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note)
    values (new.agent_id, new.policy_id, 'lapse_save', 'requested', v_due, 'system', auth.uid(),
            case new.outcome when 'fixing' then 'Check the fixed payment cleared (missed ' || to_char(ev.due_date, 'Mon FMDD')
                   || '). Call the client if it didn''t.'
                 else 'Try again: no answer on the save call (missed ' || to_char(ev.due_date, 'Mon FMDD') || ').' end)
    returning id into v_new;
    update payment_missed_events set lapse_task_id = v_new, save_due_at = v_due where id = ev.id;
  end if;
  return new;
end; $$;
revoke all on function public.payment_servicing_outcome() from public, anon, authenticated;
