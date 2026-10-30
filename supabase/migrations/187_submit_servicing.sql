-- 187 — Submit a deal, the Servicing product flag and service requests.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step.
-- Additive: new columns, one new table, two RPCs, one guard trigger. Every
-- function replaced below is copied whole from its newest version with only the
-- lines named here added. No row is changed. submit_live stays off.
--
-- Why: Book a call becomes Submit. Leads and Servicing are two independent
-- products, so an agent can be Leads only. A submission counts 1 of the week's
-- 7/16; later requests go through the same queue and don't count.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   profiles.has_servicing      read it through get_my_profile() or
--                               admin_list_profiles() (select *). Migration 112
--                               scopes direct select on profiles to directory
--                               columns, and this one isn't added to them.
--   app_settings.submit_live
--   policies.replaced_old_policy / new_carrier_id / new_carrier_name /
--            best_time / policy_number
--   table service_requests
--   rpc agent_submit_deal(p_first, p_last, p_phone, p_city, p_state, p_timezone,
--     p_new_carrier, p_policy_number, p_replaced, p_old_carrier, p_at,
--     p_best_time, p_sms_consent) returns the policy id. Call it with named
--     arguments. Postgres refuses a required parameter after one with a default,
--     so p_replaced, p_best_time and p_sms_consent carry a default too; the body
--     still refuses a null p_replaced or p_best_time.
--   rpc agent_submit_service_request(p_policy, p_kind, p_note, p_best_time)
--   error hints: weekly_cap, no_servicing, not_live. Two more on the same errors
--     the portal already shows: booking_rule (a Yes deal's time, from the
--     147 trigger) and no_old_policy (a rep, call time or leaving-carrier was
--     put on a No deal).
--   policy_events kinds: 'submitted' and 'service_request' are new; detail.label
--     holds the words. A No deal writes 'submitted' only, because no call was
--     booked. A Yes deal also keeps the 'booked' row the trigger has always
--     written, so it counts once only if the Activity box skips 'submitted'
--     rows whose detail.replaced is true.
--
-- WHAT policies.carrier_* MEANS: carrier_id / carrier_name stay "the carrier the
-- client is LEAVING". The carrier the deal was written with lives only in
-- new_carrier_*. policy_number is the column from 072 and stays optional.
--
-- NO DEALS (replaced_old_policy = false) never reach a rep:
--   * they keep fulfillment_assigned = true, so they count on agent_weekly_usage
--     and show on Clients;
--   * fulfillment_autoassign and fulfillment_assign_unassigned skip them;
--   * fulfillment_assigned_notify doesn't notify. 146 removed its trigger, so that
--     body runs nowhere today; it is changed in case the trigger comes back. The
--     rep's live alert is call_booked in policies_notify (146), which needs a rep
--     and a time, so a No deal can't send one;
--   * the guard trigger refuses a rep, a call time or a leaving carrier on one,
--     so admin_give_call, fulfillment_pass_on, agent_change_booking and
--     agent_set_booking_carrier all stop with hint no_old_policy. A No deal can't
--     be edited through Change a booking until that RPC learns about them.
--   * Rep pay: fulfillment_cancel_on_result (145) returns early when
--     assigned_fulfillment_id is null, and only the assigned rep can log
--     Cancelled (fulfillment_mark_cancelled, 159), so with no rep no pay row can
--     be created.
-- Rows with replaced_old_policy null (everything that exists today, and the old
-- direct insert) behave exactly as before.
--
-- NULL scheduled_call_at, consumer by consumer:
--   enforce_agent_booking_rules (147)  refused it: fixed below
--   policy_events_log (121)            wrote "booked": fixed below
--   agent_weekly_usage (131)           counts on fulfillment_assigned + created_at: fine
--   policies_notify (146)              needs a rep and a time for call_booked; the
--                                      weekly_limit notice doesn't read the time: fine
--   146 soon / late crons, 155 missed sweep, 122/155 recovery and rebook
--                                      all need a rep, a time or a no_answer: fine
--   fulfillment_pick_rep (156)         counts only rows held by a rep: fine
--
-- THE WEEKLY CAP: agent_submit_deal is security definer, so inside it current_user
-- is the owner and enforce_weekly_submission_cap returns early. The RPC takes the
-- same advisory lock and reads agent_weekly_usage itself. Comped agents: since
-- 131, billing_exempt only stops billing and locking. A comped agent keeps the cap
-- of its tier and comped agents sit on Premium (16), so the 8th deal goes through
-- on Premium and the 17th doesn't. The RPC does the same, not a free pass.
--
-- THE has_servicing GUARD is a sibling trigger, not a new line in
-- enforce_weekly_submission_cap. a2_ fires before policies_booking_rules and
-- policies_enforce_weekly_cap, so it sits ahead of that function's not-enforced
-- return. The reason for a sibling is the branch below.
--
-- RELATION TO BRANCH atlas/0f011681-servicing-inbound-spend-migration (unmerged,
-- file NEXT_inbound_spend.sql, no number yet): no name collides. It adds
-- agent_inbound_spend, agent_inbound_spend_log and app_settings.inbound_* and no
-- servicing flag, so has_servicing is a new name here. It does replace
-- enforce_weekly_submission_cap with a body that never refuses. That can't remove
-- the guard here, which lives in its own trigger. It also doesn't stop the check
-- inside agent_submit_deal: if that branch merges and the cap is meant to go for
-- Submit too, this RPC's check has to go with it.
--
-- service_requests is separate from servicing_tasks (180). That table is the work
-- on a client, seeded by Sold, with its own kinds and statuses and no best time.
-- membership_tiers (180) are unassigned drafts and don't set has_servicing.

-- ── 1. Who has Servicing ────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists has_servicing boolean not null default true;

comment on column public.profiles.has_servicing is
  'False = Leads only: can''t submit a deal or a service request. Admin-only to change.';

-- Same as 156, plus has_servicing in the admin-only list.
create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Change role or access from the Users page' using errcode = '42501';
    end if;
    if new.is_demo is distinct from old.is_demo or new.deleted_at is distinct from old.deleted_at then
      raise exception 'That part of a profile can''t be changed' using errcode = '42501';
    end if;
    if not public.is_admin() and (
       new.upline_id                        is distinct from old.upline_id
    or new.stripe_account_id                is distinct from old.stripe_account_id
    or new.stripe_onboarding_complete       is distinct from old.stripe_onboarding_complete
    or new.training_completed               is distinct from old.training_completed
    or new.last_batch_assigned_local_date   is distinct from old.last_batch_assigned_local_date
    or new.leaderboard_rank1_notified_month is distinct from old.leaderboard_rank1_notified_month
    or new.goal_50_notified_month           is distinct from old.goal_50_notified_month
    or new.goal_100_notified_month          is distinct from old.goal_100_notified_month
    or new.created_at                       is distinct from old.created_at
    or new.billing_status                   is distinct from old.billing_status
    or new.stripe_customer_id               is distinct from old.stripe_customer_id
    or new.stripe_subscription_id           is distinct from old.stripe_subscription_id
    or new.billing_current_period_end       is distinct from old.billing_current_period_end
    or new.billing_grace_until              is distinct from old.billing_grace_until
    or new.billing_updated_at               is distinct from old.billing_updated_at
    or new.billing_tier                     is distinct from old.billing_tier
    or new.billing_exempt                   is distinct from old.billing_exempt
    or new.has_servicing                    is distinct from old.has_servicing
    ) then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Same list as 153, plus has_servicing: a plan change is on the audit log like
-- billing_tier is.
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles
  for each row execute function public.audit_row(
    'role', 'is_active', 'upline_id', 'billing_exempt', 'billing_tier', 'stripe_account_id', 'has_servicing');

-- ── 2. The switch ───────────────────────────────────────────────────────────
-- "Admins update app settings" (091) covers it. audit_app_settings logs every column.
alter table public.app_settings
  add column if not exists submit_live boolean not null default false;

comment on column public.app_settings.submit_live is
  'On = agent_submit_deal and agent_submit_service_request accept work. Off until Brayden turns it on.';

-- ── 3. The deal ─────────────────────────────────────────────────────────────
alter table public.policies
  add column if not exists new_carrier_id uuid references public.carriers(id) on delete set null,
  add column if not exists new_carrier_name text,
  add column if not exists replaced_old_policy boolean,
  add column if not exists best_time text check (best_time in ('morning', 'afternoon', 'evening'));

comment on column public.policies.new_carrier_id is
  'The carrier the deal was written with. carrier_id stays the carrier the client is leaving.';
comment on column public.policies.new_carrier_name is
  'Name of new_carrier_id when the deal was submitted.';
comment on column public.policies.replaced_old_policy is
  'True = there is an old policy to cancel, a rep works it. False = none, never goes to a rep. Null = booked before Submit.';
comment on column public.policies.best_time is
  'When the client prefers to hear from us: morning, afternoon or evening.';

alter table public.policy_events drop constraint policy_events_kind_check;
alter table public.policy_events add constraint policy_events_kind_check
  check (kind = any (array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned',
                           'submitted', 'service_request']));

-- ── 4. The guard ────────────────────────────────────────────────────────────
-- Agents can't read has_servicing directly (112), and the trigger below has to
-- run as the caller so current_user still tells a direct write from an RPC.
create or replace function public.my_lacks_servicing()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'agent' and not has_servicing
  )
$$;
revoke all on function public.my_lacks_servicing() from public, anon;
grant execute on function public.my_lacks_servicing() to authenticated;

-- Direct writes by a signed-in non-admin: no Servicing means no row that goes to
-- Fulfillment, and replaced_old_policy is ignored (as 147 ignores a direct
-- insert's result columns), so the No-deal path is only reachable through
-- agent_submit_deal. Every caller: a No deal has no rep, call time or leaving
-- carrier. The RPCs run as the owner, so they pass the first part and do their
-- own check.
create or replace function public.policies_servicing_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.replaced_old_policy := null;
    else
      new.replaced_old_policy := old.replaced_old_policy;
    end if;
    if coalesce(new.fulfillment_assigned, false)
       and (tg_op = 'INSERT' or not coalesce(old.fulfillment_assigned, false))
       and public.my_lacks_servicing() then
      raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
    end if;
  end if;

  if new.replaced_old_policy is false
     and (new.assigned_fulfillment_id is not null or new.scheduled_call_at is not null
          or new.carrier_id is not null or new.carrier_name is not null) then
    raise exception 'This deal has no old policy to cancel, so it has no call, carrier to leave or rep.'
      using errcode = '22023', hint = 'no_old_policy';
  end if;
  return new;
end;
$$;
revoke all on function public.policies_servicing_guard() from public, anon, authenticated;

-- a2_ sorts after a0_block_inactive_writer and a1_policies_demo, and before
-- policies_booking_rules and policies_enforce_weekly_cap.
drop trigger if exists a2_policies_servicing_guard on public.policies;
create trigger a2_policies_servicing_guard before insert or update on public.policies
  for each row execute function public.policies_servicing_guard();

-- ── 5. No deals never reach a rep ───────────────────────────────────────────
-- 116, plus the replaced_old_policy line.
create or replace function public.fulfillment_autoassign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.fulfillment_assigned, false)
     or new.fulfillment_stage is not distinct from 'Complete' then
    return new;
  end if;

  if new.replaced_old_policy is false then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_fulfillment_id is null then
      new.assigned_fulfillment_id := public.fulfillment_pick_rep(new.scheduled_call_at, new.id);
      if new.assigned_fulfillment_id is not null then
        new.fulfillment_claimed_at := now();
      end if;
    end if;
    return new;
  end if;

  -- UPDATE. Nothing open should sit unassigned while a rep exists.
  if new.assigned_fulfillment_id is null then
    new.assigned_fulfillment_id := public.fulfillment_pick_rep(new.scheduled_call_at, new.id);
  -- Rescheduled before the rep started it: re-check who's free at the new time.
  elsif new.scheduled_call_at is distinct from old.scheduled_call_at
        and new.fulfillment_stage = 'Pending' then
    new.assigned_fulfillment_id := coalesce(
      public.fulfillment_pick_rep(new.scheduled_call_at, new.id, null, new.assigned_fulfillment_id),
      new.assigned_fulfillment_id);
  end if;
  return new;
end;
$$;

-- 116, plus the replaced_old_policy line.
create or replace function public.fulfillment_assigned_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('ohvara.skip_assign_notify', true), '') = 'on' then
    return new;
  end if;
  if new.fulfillment_assigned
     and new.replaced_old_policy is distinct from false
     and new.assigned_fulfillment_id is not null
     and new.fulfillment_stage is distinct from 'Complete'
     and (tg_op = 'INSERT' or new.assigned_fulfillment_id is distinct from old.assigned_fulfillment_id) then
    insert into notifications (profile_id, type, message, data)
    values (
      new.assigned_fulfillment_id, 'fulfillment_assigned',
      coalesce(nullif(trim(coalesce(new.client_first_name, '') || ' ' || coalesce(new.client_last_name, '')), ''), 'A client')
        || ' is on your desk.',
      jsonb_build_object('policy_id', new.id, 'link', '/fulfillment/desk?open=' || new.id)
    );
  end if;
  return new;
end;
$$;

-- 116, plus the replaced_old_policy line.
create or replace function public.fulfillment_assign_unassigned()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if not (public.is_admin() or public.is_fulfillment()) then
    return 0;
  end if;
  for r in
    select id from policies
    where fulfillment_assigned and assigned_fulfillment_id is null
      and fulfillment_stage is distinct from 'Complete'
      and replaced_old_policy is distinct from false
    order by scheduled_call_at nulls last, created_at
    for update skip locked
  loop
    -- the autoassign trigger does the picking
    update policies set assigned_fulfillment_id = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── 6. A counted row with no call time ──────────────────────────────────────
-- 147, plus the replaced_old_policy line. The guard above already ignored the
-- column on a direct write, so only agent_submit_deal gets past "a time is
-- required" here.
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
  if new.replaced_old_policy is false then return new; end if;
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

-- 121, plus the replaced_old_policy line: "You booked the call" would be false.
-- agent_submit_deal writes the No deal's 'submitted' row.
create or replace function public.policy_events_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_name   text;
  v_role   text;
  v_old    text;
  v_new    text;
  v_detail jsonb;
begin
  if not new.fulfillment_assigned then
    return new;
  end if;

  if v_actor is not null then
    select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
      into v_name, v_role
    from profiles where id = v_actor;
  end if;

  v_new := public.policy_agent_status(new.fulfillment_stage::text, new.call_live_since, new.last_call_outcome);

  if tg_op = 'INSERT' or not old.fulfillment_assigned then
    if new.replaced_old_policy is false then
      return new;
    end if;
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, 'booked', v_actor, v_name, v_role,
            jsonb_build_object('scheduled_call_at', new.scheduled_call_at));
    return new;
  end if;

  v_old := public.policy_agent_status(old.fulfillment_stage::text, old.call_live_since, old.last_call_outcome);

  if v_new is distinct from v_old then
    v_detail := case v_new
      when 'no_answer'    then jsonb_build_object('reason', new.cancellation_substatus, 'attempt', new.call_attempts)
      when 'in_progress'  then jsonb_build_object('attempt', new.call_attempts)
      when 'cancelled'    then jsonb_build_object('confirmation', new.cancellation_confirmation)
      else '{}'::jsonb
    end;
    insert into policy_events (policy_id, agent_id, kind, from_status, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, v_new, v_old, v_actor, v_name, v_role, v_detail);
  end if;

  if new.scheduled_call_at is distinct from old.scheduled_call_at and v_new <> 'cancelled' then
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, 'moved', v_actor, v_name, v_role,
            jsonb_build_object('from', old.scheduled_call_at, 'to', new.scheduled_call_at));
  end if;

  return new;
end;
$$;

-- ── 7. Submit a deal ────────────────────────────────────────────────────────
create or replace function public.agent_submit_deal(
  p_first         text,
  p_last          text,
  p_phone         text,
  p_city          text,
  p_state         text,
  p_timezone      text,
  p_new_carrier   uuid,
  p_policy_number text default null,
  p_replaced      boolean default null,
  p_old_carrier   uuid default null,
  p_at            timestamptz default null,
  p_best_time     text default null,
  p_sms_consent   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent    uuid := auth.uid();
  v_servicing boolean;
  v_name     text;
  u          record;
  v_first    text := nullif(btrim(p_first), '');
  v_last     text := nullif(btrim(p_last), '');
  v_phone    text := nullif(btrim(p_phone), '');
  v_city     text := nullif(btrim(p_city), '');
  v_state    text := nullif(upper(btrim(p_state)), '');
  v_tz       text := nullif(btrim(p_timezone), '');
  v_new_name text;
  v_old_name text;
  v_id       uuid;
begin
  select has_servicing, coalesce(nullif(btrim(full_name), ''), 'Unknown') into v_servicing, v_name
    from profiles where id = v_agent and role = 'agent' and is_active;
  if not found then
    raise exception 'Only an agent can submit a deal' using errcode = '42501';
  end if;
  if not coalesce((select submit_live from app_settings where id = 1), false) then
    raise exception 'Submit is not live yet' using errcode = 'P0001', hint = 'not_live';
  end if;
  if not v_servicing then
    raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
  end if;

  -- The same lock and the same rules as enforce_weekly_submission_cap (147),
  -- which steps aside here because current_user is the owner.
  perform pg_advisory_xact_lock(hashtextextended('weekly_cap:' || v_agent::text, 0));
  select * into u from public.agent_weekly_usage(v_agent);
  if found and u.enforced and u.weekly_cap is not null and u.used >= u.weekly_cap then
    raise exception 'Weekly submission cap reached: % of % used this week on the % plan.',
      u.used, u.weekly_cap, u.tier_name
      using errcode = 'P0001', hint = 'weekly_cap';
  end if;

  if v_first is null or v_last is null then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 10 then
    raise exception 'Add the client''s 10-digit phone number' using errcode = '22023';
  end if;
  if v_city is null or v_state is null or v_state !~ '^[A-Z]{2}$' then
    raise exception 'Add the client''s city and state' using errcode = '22023';
  end if;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  select name into v_new_name from carriers where id = p_new_carrier;
  if v_new_name is null then
    raise exception 'Pick the new carrier from the list' using errcode = '22023';
  end if;
  if p_replaced is null then
    raise exception 'Say whether this replaced an old policy' using errcode = '22023';
  end if;
  if p_best_time is null or p_best_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Pick the best time to reach them' using errcode = '22023';
  end if;
  if p_replaced then
    select name into v_old_name from carriers where id = p_old_carrier;
    if v_old_name is null then
      raise exception 'Pick the carrier they''re leaving' using errcode = '22023', hint = 'booking_rule';
    end if;
    if p_at is null then
      raise exception 'Pick a time for the call.' using errcode = '22023', hint = 'booking_rule';
    end if;
  end if;

  -- A Yes deal's slot (30 minutes' notice, carrier hours, no double booking) is
  -- checked by policies_booking_rules on this insert: it keys on auth.uid(), not
  -- current_user, so it fires here.
  insert into policies (
    agent_id, status, client_first_name, client_last_name, client_phone, client_city, state, client_timezone,
    carrier_id, carrier_name, new_carrier_id, new_carrier_name, policy_number, replaced_old_policy, best_time,
    pending_underwriting, fulfillment_assigned, fulfillment_stage, scheduled_call_at, sms_consent
  ) values (
    v_agent, 'Submitted', v_first, v_last, v_phone, v_city, v_state, v_tz,
    case when p_replaced then p_old_carrier end, case when p_replaced then v_old_name end,
    p_new_carrier, v_new_name, nullif(btrim(p_policy_number), ''), p_replaced, p_best_time,
    false, true, 'Pending', case when p_replaced then p_at end, coalesce(p_sms_consent, false)
  )
  returning id into v_id;

  -- Having this row keeps Fulfillment's "No intake details" warning from firing.
  insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
  values (v_id, v_first || ' ' || v_last, case when p_replaced then v_old_name end);

  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (v_id, v_agent, 'submitted', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Submitted for servicing', 'replaced', p_replaced,
                             'best_time', p_best_time, 'scheduled_call_at', case when p_replaced then p_at end));

  return v_id;
end;
$$;

revoke all on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean) from public, anon;
grant execute on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean) to authenticated;

-- ── 8. Service requests ─────────────────────────────────────────────────────
create table if not exists public.service_requests (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  policy_id   uuid not null references public.policies(id) on delete cascade,
  kind        text not null check (kind in (
                'beneficiary_change', 'address_change', 'payment_method_change', 'draft_date_change',
                'lapse_help', 'claims_help', 'carrier_call'
              )),
  note        text,
  best_time   text check (best_time in ('morning', 'afternoon', 'evening')),
  status      text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists service_requests_agent_idx on public.service_requests (agent_id, created_at desc);
create index if not exists service_requests_policy_idx on public.service_requests (policy_id);
create index if not exists service_requests_open_idx on public.service_requests (created_at) where status in ('open', 'in_progress');

alter table public.service_requests enable row level security;

-- Agents read their own (and their downline's, like policies_select). The queue
-- is Fulfillment's and admin's. They change the status and nothing else. No
-- insert policy and no insert grant: agent_submit_service_request is the way in.
drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests
  for select to authenticated
  using (public.can_view_agent(agent_id) or public.is_fulfillment());

drop policy if exists service_requests_update on public.service_requests;
create policy service_requests_update on public.service_requests
  for update to authenticated
  using (public.is_admin() or public.is_fulfillment())
  with check (public.is_admin() or public.is_fulfillment());

drop policy if exists service_requests_demo_wall on public.service_requests;
create policy service_requests_demo_wall on public.service_requests as restrictive for all to authenticated
  using (public.policy_is_demo(policy_id) = (select public.my_is_demo()))
  with check (public.policy_is_demo(policy_id) = (select public.my_is_demo()));

revoke all on public.service_requests from public, anon, authenticated;
grant select on public.service_requests to authenticated;
grant update (status) on public.service_requests to authenticated;

drop trigger if exists a0_block_inactive_writer on public.service_requests;
create trigger a0_block_inactive_writer
  before insert or update or delete on public.service_requests
  for each row execute function public.block_inactive_writer();

drop trigger if exists service_requests_updated_at on public.service_requests;
create trigger service_requests_updated_at
  before update on public.service_requests
  for each row execute function public.set_updated_at();

comment on table public.service_requests is
  'An agent asking for work on a client. Written only by agent_submit_service_request. Doesn''t count against the weekly cap.';

create or replace function public.agent_submit_service_request(
  p_policy    uuid,
  p_kind      text,
  p_note      text,
  p_best_time text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent     uuid := auth.uid();
  v_servicing boolean;
  v_name      text;
  v_id        uuid;
begin
  select has_servicing, coalesce(nullif(btrim(full_name), ''), 'Unknown') into v_servicing, v_name
    from profiles where id = v_agent and role = 'agent' and is_active;
  if not found then
    raise exception 'Only an agent can send a request' using errcode = '42501';
  end if;
  if not coalesce((select submit_live from app_settings where id = 1), false) then
    raise exception 'Submit is not live yet' using errcode = 'P0001', hint = 'not_live';
  end if;
  if not v_servicing then
    raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
  end if;
  if not exists (select 1 from policies where id = p_policy and agent_id = v_agent) then
    raise exception 'Not your client' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('beneficiary_change', 'address_change', 'payment_method_change',
                                      'draft_date_change', 'lapse_help', 'claims_help', 'carrier_call') then
    raise exception 'Pick what the client needs' using errcode = '22023';
  end if;
  if p_best_time is not null and p_best_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Pick the best time to reach them' using errcode = '22023';
  end if;

  insert into service_requests (agent_id, policy_id, kind, note, best_time)
  values (v_agent, p_policy, p_kind, nullif(left(btrim(p_note), 1000), ''), p_best_time)
  returning id into v_id;

  -- The note isn't copied: events are read wider than the request itself.
  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (p_policy, v_agent, 'service_request', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Service request', 'request_id', v_id, 'request_kind', p_kind, 'best_time', p_best_time));

  return v_id;
end;
$$;

revoke all on function public.agent_submit_service_request(uuid, text, text, text) from public, anon;
grant execute on function public.agent_submit_service_request(uuid, text, text, text) to authenticated;
