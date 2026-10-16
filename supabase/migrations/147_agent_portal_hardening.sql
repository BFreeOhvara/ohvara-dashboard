-- 147 — Agent portal hardening (Prompt 768, P743 QA Findings 1–3, 8, 9).
--
-- The booking rules used to live only in the agent UI. These make the
-- database hold them too, so someone calling the API directly with an agent's
-- login gets the same answer as the portal. A normal agent clicking normally
-- sees no change.

-- ── 1. Agents can't edit or delete bookings directly (Finding 1) ──────────
-- Every agent change already goes through security-definer RPCs
-- (agent_change_booking, agent_rebook_call, agent_set_booking_carrier,
-- agent_confirm_recovery_number), which keep their own checks. Agents keep
-- INSERT (Book a call) and SELECT. Fulfillment keeps fulfillment_update_assigned.
-- No policy grants DELETE any more, so nobody signed in can delete a booking.
drop policy if exists policies_update on public.policies;
drop policy if exists policies_delete on public.policies;

-- The intake row: only the assigned Fulfillment rep edits it directly. The
-- agent's edits (name, carrier) go through agent_change_booking /
-- agent_set_booking_carrier. Agents still insert it once, on booking.
drop policy if exists fulfillment_details_update on public.policy_fulfillment_details;
create policy fulfillment_details_update on public.policy_fulfillment_details
  for update using (
    exists (select 1 from public.policies p
             where p.id = policy_fulfillment_details.policy_id
               and p.assigned_fulfillment_id = auth.uid())
  );

-- ── 2. The weekly cap holds on every path that makes a booking count ──────
-- A booking counts toward the agent's week when fulfillment_assigned is true
-- and created_at is inside that week (agent_weekly_usage, the one source of
-- truth for the meter and this check). Before, only INSERT was checked, so an
-- unassigned insert flipped to assigned got to 17 of 16. Now an UPDATE that
-- makes a row start counting (assigned flipped on, moved to another agent,
-- or created_at moved into this week) is checked the same way. Rebooks and
-- time changes don't touch either column, so they never use a booking.
-- agent_billing_enforced and the comped rules (migration 131) are unchanged:
-- they live in agent_weekly_usage.
create or replace function public.enforce_weekly_submission_cap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  u record;
begin
  if not coalesce(new.fulfillment_assigned, false) then return new; end if;
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('weekly_cap:' || new.agent_id::text, 0));

  select * into u from public.agent_weekly_usage(new.agent_id);
  if not found or not u.enforced or u.weekly_cap is null then return new; end if;

  if tg_op = 'UPDATE' then
    -- Only a row that starts counting for this agent this week can go over.
    if not (new.created_at >= u.week_start and new.created_at < u.week_end) then return new; end if;
    if coalesce(old.fulfillment_assigned, false)
       and old.agent_id is not distinct from new.agent_id
       and old.created_at >= u.week_start and old.created_at < u.week_end then
      return new;
    end if;
  end if;

  if u.used >= u.weekly_cap then
    raise exception 'Weekly submission cap reached: % of % used this week on the % plan.',
      u.used, u.weekly_cap, u.tier_name
      using errcode = 'P0001', hint = 'weekly_cap';
  end if;
  return new;
end;
$function$;

drop trigger if exists policies_enforce_weekly_cap on public.policies;
create trigger policies_enforce_weekly_cap
  before insert or update of fulfillment_assigned, agent_id, created_at on public.policies
  for each row execute function public.enforce_weekly_submission_cap();

-- ── 3. Booking rules on the server (Finding 3) ────────────────────────────
-- The same rules Book a call, Change a booking and the re-book use
-- (src/lib/scheduling.js + carriers.js), checked whenever an agent books or
-- moves a call time — directly or through the agent RPCs:
--   • a time is required;
--   • at least 30 minutes ahead (NOTICE_MS);
--   • no other open booking of the agent's at that same instant;
--   • the carrier takes calls then, starting at least an hour before it
--     closes (CLOSE_BUFFER_MIN), in the carrier's zone. A carrier with no
--     hours that day (every live carrier on weekends) means no call;
--   • 8:00 AM–8:00 PM on the client's clock.
-- Hours: the carrier row's saved hours. When those aren't fresh (none, older
-- than 180 days, or a saved fallback older than 7), the portal may be showing
-- Mon–Fri 9–5 Eastern instead, so that window is accepted too.
-- Admins, Fulfillment, the recovery flow and crons aren't the booking agent
-- (or have no auth.uid()), so they're not held to these.

-- Can a call start at `p_at` within `p_hours` (carrier zone `p_tz`)?
create or replace function public.booking_hours_ok(p_at timestamptz, p_hours jsonb, p_tz text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  with w as (
    select lower(to_char(p_at at time zone p_tz, 'Dy')) as d,
           extract(hour from p_at at time zone p_tz)::int * 60
             + extract(minute from p_at at time zone p_tz)::int as m
  ), h as (
    select (p_hours -> w.d ->> 'open') as o, (p_hours -> w.d ->> 'close') as c, w.m from w
  )
  select coalesce((
    select h.o is not null and h.c is not null
       and h.m >= split_part(h.o, ':', 1)::int * 60 + split_part(h.o, ':', 2)::int
       and h.m <= split_part(h.c, ':', 1)::int * 60 + split_part(h.c, ':', 2)::int - 60
    from h), false);
$function$;

create or replace function public.enforce_agent_booking_rules()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c        carriers;
  v_fresh  boolean;
  v_nine5  constant jsonb := '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":{"open":"09:00","close":"17:00"},"thu":{"open":"09:00","close":"17:00"},"fri":{"open":"09:00","close":"17:00"}}';
  v_min    int;
begin
  if auth.uid() is null or auth.uid() is distinct from new.agent_id or public.is_admin() then return new; end if;

  -- A new booking starts as Booked, made now. Whatever an agent's direct
  -- insert says about the result, the Fulfillment rep or the clock is
  -- ignored: only Fulfillment's RPCs set a result, and a backdated
  -- created_at would slip past this week's cap. Book a call sends none of
  -- these, so nothing changes for it.
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.fulfillment_stage := case when coalesce(new.fulfillment_assigned, false) then 'Pending' else null end;
    new.assigned_fulfillment_id := null;
    new.fulfillment_claimed_at := null;
    new.fulfillment_started_at := null;
    new.fulfillment_completed_at := null;
    new.call_live_since := null;
    new.last_call_outcome := null;
    new.last_call_at := null;
    new.call_attempts := 0;
    new.cancellation_substatus := null;
    new.cancellation_confirmation := null;
    new.cancellation_notes := null;
    new.cancellation_effective_date := null;
    new.archived_at := null;
    new.recovery_phase := null; new.recovery_step := null; new.recovery_retry_at := null;
    new.recovery_next_kind := null; new.recovery_next_at := null; new.recovery_followup_day := null;
    new.recovery_text1_sent_at := null; new.recovery_text2_sent_at := null;
    new.recovery_am_sent_at := null; new.recovery_pm_sent_at := null;
    new.recovery_number_confirmed_at := null; new.recovery_handoff_at := null;
    new.recovery_responded_at := null;
    new.recovery_token := gen_random_uuid();
  end if;

  if not coalesce(new.fulfillment_assigned, false) then return new; end if;
  if tg_op = 'UPDATE' and new.scheduled_call_at is not distinct from old.scheduled_call_at then return new; end if;

  if new.scheduled_call_at is null then
    raise exception 'Pick a time for the call.' using errcode = '22023', hint = 'booking_rule';
  end if;
  if new.scheduled_call_at < now() + interval '30 minutes' then
    raise exception 'Pick a time at least 30 minutes from now.' using errcode = '22023', hint = 'booking_rule';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('booking_slot:' || new.agent_id::text, 0));
  if exists (
    select 1 from policies o
     where o.agent_id = new.agent_id
       and o.id is distinct from new.id
       and o.fulfillment_assigned
       and o.fulfillment_stage is distinct from 'Complete'
       and o.scheduled_call_at = new.scheduled_call_at
  ) then
    raise exception 'You already have a call booked at that time. Pick another time.' using errcode = '22023', hint = 'booking_rule';
  end if;

  if new.client_timezone is null then
    raise exception 'Add the client''s city and state first.' using errcode = '22023', hint = 'booking_rule';
  end if;
  v_min := extract(hour from new.scheduled_call_at at time zone new.client_timezone)::int * 60
         + extract(minute from new.scheduled_call_at at time zone new.client_timezone)::int;
  if v_min < 8 * 60 or v_min > 20 * 60 then
    raise exception 'That''s outside 8 AM–8 PM for the client. Pick another time.' using errcode = '22023', hint = 'booking_rule';
  end if;

  select * into c from carriers where id = new.carrier_id;
  if not found then
    raise exception 'Pick the carrier from the list.' using errcode = '22023', hint = 'booking_rule';
  end if;
  v_fresh := c.hours is not null and c.hours_tz is not null and c.hours_checked_at is not null
             and c.hours_checked_at > now() - case when c.hours_status = 'fallback'
                                                   then interval '7 days' else interval '180 days' end;
  if not (
       (c.hours is not null and c.hours_tz is not null and public.booking_hours_ok(new.scheduled_call_at, c.hours, c.hours_tz))
    or (not v_fresh and public.booking_hours_ok(new.scheduled_call_at, v_nine5, 'America/New_York'))
  ) then
    raise exception '% doesn''t take calls then. Pick another time.', c.name using errcode = '22023', hint = 'booking_rule';
  end if;

  return new;
end;
$function$;

drop trigger if exists policies_booking_rules on public.policies;
create trigger policies_booking_rules
  before insert or update of scheduled_call_at on public.policies
  for each row execute function public.enforce_agent_booking_rules();

-- QA advisor note: the booking table's carrier FK had no index.
create index if not exists policies_carrier_id_idx on public.policies (carrier_id);

-- ── 4. Close the open doors (Findings 8–9) ────────────────────────────────
-- resolve_login_email gave anyone signed out the email for a username. The
-- username-sign-in edge function now resolves and signs in on the server, so
-- nobody but the service role needs it. Kept, not dropped.
revoke execute on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;

-- Pre-pivot lead RPCs: nothing signed out calls them. Only request_rep_leads
-- is still referenced by the app (the old rep lead page), so it keeps
-- authenticated. Their crons run as postgres and are unaffected.
revoke execute on function public.assign_daily_batches(integer) from public, anon, authenticated;
revoke execute on function public.eod_pipeline_sweep() from public, anon, authenticated;
revoke execute on function public.process_lead_queues() from public, anon, authenticated;
revoke execute on function public.request_closer_leads(uuid, integer) from public, anon, authenticated;
revoke execute on function public.request_rep_leads(uuid, integer) from public, anon;
grant execute on function public.request_rep_leads(uuid, integer) to authenticated;

-- Signed-in-only RPCs that anon could still reach (each checks auth.uid()).
revoke execute on function public.agent_set_booking_carrier(uuid, uuid) from public, anon;
revoke execute on function public.carrier_add(text) from public, anon;
revoke execute on function public.my_standing_threads() from public, anon;
grant execute on function public.agent_set_booking_carrier(uuid, uuid) to authenticated;
grant execute on function public.carrier_add(text) to authenticated;
grant execute on function public.my_standing_threads() to authenticated;

-- Security-definer trigger functions: firing a trigger doesn't need EXECUTE,
-- and nobody should call one as an RPC.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- send-appointment-reminders posted every 5 minutes to a function that was
-- never deployed (404s), for the pre-pivot appointments table (0 rows).
select cron.unschedule(jobid) from cron.job where jobname = 'send-appointment-reminders';
