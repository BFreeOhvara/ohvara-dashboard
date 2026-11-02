-- 212 — One servicing seed: a deal and a Sold lead both make the same 14 steps from the
-- same settings, and every client gets a servicing VA who owns the client thread.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step at the door.
-- Hook fix live first: the one-watch-row task must be merged and deployed before this is
-- applied. Without it the Clients pages read month 1 of 12 monthly rows as the whole watch.
-- It applies only after 193_servicing_model.sql, 195_servicing_functions.sql,
-- 201_agent_products.sql, 206_va_servicing.sql and 209_activity_lapse_events.sql: its first
-- statement stops the whole file if any is missing. No backfill, no row changes, nothing
-- deleted. No screen, and no new servicing kind. sms_live, voice_live and every other live
-- switch stay as they are. An old client keeps the rows it has.
--
-- Why: Fulfillment Build Order, Lane A items 1 and 6, Eagle's calls 1 and 2. Brayden's
-- meaning: nobody is ever missed and no agent screen breaks. Two seeds disagreed (201 made
-- +3, +10 and one watch at +12 months; 193 made +7, +30 and +12 months) and nothing held a
-- servicing VA. This is one file on purpose: seeding 12 rows without the queue and feed
-- changes would flood both, so they apply together.
--
-- CHECKS TO RUN BEFORE APPLYING (read only). This count must be 0. The first statement
-- below runs the same count and stops the file, naming the number, if it isn't. 180's index
-- is per lead, so two sold leads on one client_policy_id could already hold duplicates.
-- It only means this before applying: afterwards every client's 12 monthly rows would count.
--   select count(*) from (
--     select 1 from public.servicing_tasks
--      where policy_id is not null and requested_by = 'system'
--        and kind in ('packet_check', 'review_call', 'chargeback_watch')
--      group by policy_id, kind having count(*) > 1
--   ) d;
--
-- COPIED WHOLE, from their newest versions (grep on master, Nov 1), with only these lines
-- changed:
--   agent_submit_deal          201. v_anchor is gone, the duplicate lookup is added, and the
--                              3-row insert and its comment become the seed call.
--   set_inbound_outcome        193. The 3-row insert becomes the seed call.
--   va_servicing_queue         206. v_window and its read are added, and one line in WHERE.
--   va_servicing_claim         206. v_window and its read are added, and one line in WHERE.
--   agent_activity_feed        209, not 206: 209 replaced it after this work was planned.
--                              One line added to the servicing_added branch.
--   policies_servicing_guard   187. Four lines added, two on insert and two on update.
--
-- THE ANCHOR. With a policy, coalesce(effective_date, policy_sold_date, created_at::date),
-- the view's own (206:1273). Without one, current_date, 195's fallback. Policies has no
-- delivery date, so the review call counts from this same anchor. Each due_at is noon UTC,
-- 193's rule: the same calendar day in every US time zone. Months are worked out from the
-- anchor each time and not step by step, so Jan 31 gives Feb 28 or 29, then Mar 31, and
-- month 12 equals the view's watch end.
--
-- TWELVE MONTHS IS FIXED and is not a setting, because the view and the pages say "of 12".
-- The three day counts are settings; no day count is in a function body. If app_settings
-- row 1 is missing, the seed, the queue and the claim refuse rather than guess a number.
--
-- OLD CLIENTS. If any system chargeback_watch already exists on that lead or that policy, no
-- watch rows are added at all. An old unnumbered row would not conflict with months 1 to 12,
-- so without this an old lead pressed Sold again would hold 13. packet_check and review_call
-- still go through on conflict do nothing.
--
-- next_date HAS A NEW MEANING, and policy_servicing_status is not replaced. 193's header
-- says a protected client's next_date is the watch end. With monthly rows it becomes the next
-- open payment check, overdue months first, because the view's lateral takes the soonest open
-- system step (206:1310-1313). agent_clients takes the min of that. This is kept on purpose:
-- no screen reads it today (BOOK_COLS is stage, open_requests). watch_month still comes from
-- the anchor (206:1314-1317), and the view still gives one row per policy.
--
-- THE OWNER. policies.servicing_va_id is the VA who owns the client thread. Every submitted
-- deal gets one, Yes and No, and so does a Sold lead's policy that has none. A re-run never
-- changes an owner, a lead with no policy gets none, and with no active VA it stays null and
-- the sale still succeeds. 187's guard doesn't read this column, so No deals work. It is
-- separate from assigned_fulfillment_id, the call rep, which works as it did. Yes deals keep
-- today's old-policy flow as that step, and the view keeps reading it.
-- servicing_va_pick takes a lock and then picks in its own statement, so two submits at once
-- can't see the same counts and tie. It can't be stable for that reason: a stable function
-- would read the snapshot from before the lock.
--
-- WHAT THE OWNER UPDATE TOUCHES (read from every trigger on policies). It sets only the two
-- owner columns, so the triggers on status, premium, carrier, scheduled_call_at,
-- fulfillment_assigned and fulfillment_stage don't fire. policy_events_log finds no status
-- or time change, so it writes no event; policies_notify sees no new rep or time, so it sends
-- no notice. updated_at moves, as on any update.
-- ONE CASE DOES MOVE A REP, and it isn't new. fulfillment_autoassign gives a rep to any open
-- booking with none on every update of that row (116). So a Sold on a lead whose policy is
-- an open Yes booking still with no rep gets that rep and that rep's call_booked notice from
-- the owner update. fulfillment_assign_unassigned does the same the next time a rep opens the
-- desk. A submit can't reach this: if no rep is active at the insert, no VA is either.
--
-- RESUBMIT. In agent_submit_deal, right after the agent's lock and before the cap refusal: a
-- non-blank policy number that matches a non-archived policy of the same agent and new
-- carrier, ignoring case and outer spaces, returns that policy's id and writes nothing. So a
-- retry at the cap returns the policy rather than a cap error. A blank or null policy number
-- never matches and makes a new row. Every other call refuses in the same order as before.
--
-- UNMERGED 210_lead_outcomes (branch atlas/29204112) removes the seed from Sold and adds two
-- arguments to set_inbound_outcome, so these two files disagree about Sold. This file's 3
-- arguments next to 210's 5 would make every call ambiguous, so the first statement stops if
-- 210 got here first. Whichever merges second must settle it.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   table app_settings, new columns, each not null and at least 0
--     servicing_packet_check_days        default 3. Anchor + this is the packet check.
--     servicing_review_call_days         default 10. Anchor + this is the review call.
--     servicing_month_check_window_days  default 7. How far ahead a VA sees a monthly check.
--   table servicing_tasks
--     watch_month    smallint, 1 to 12, only on chargeback_watch. Null on an old unnumbered
--                    row and on every other kind.
--   table policies
--     servicing_va_id           uuid -> profiles, on delete set null. Null is no owner yet.
--     servicing_va_assigned_at  timestamptz, when the owner was set.
--     Neither can be written by a signed-in non-admin: on update they keep their old value,
--     on insert they are null.
--   a deal or a Sold now holds 14 rows: one packet_check, one review_call, and
--     chargeback_watch months 1 to 12. Read the watch as one row per policy.
--   rpc va_servicing_queue(), va_servicing_claim(p_task): same names, columns and refusals.
--     A scheduled numbered month due further ahead than the window is hidden, and claiming
--     one is the existing 22023 'This step is not in the queue'. Overdue months, in progress
--     rows and unnumbered old rows behave as they did.
--   agent_activity_feed: same signature and grants. A deal still shows three servicing_added
--     rows (month 1 stands for the watch). servicing_done is unchanged: any month done shows.
--   view policy_servicing_status: same columns. See next_date above.
--   rpc agent_submit_deal, set_inbound_outcome: same signatures and grants.
--   servicing_seed_steps, servicing_va_pick: no signed-in role can call them.
--
-- Who can write servicing_tasks: servicing_seed_steps (for agent_submit_deal and
-- set_inbound_outcome), agent_submit_service_request, fulfillment_schedule_request,
-- fulfillment_finish_request, the va_servicing_* functions, agent_servicing_clear_sent and
-- the service role.
--
-- TESTS. The real run is at the apply step, against the applied migration:
-- supabase/tests/p_servicing_steps.sql. No robot can run SQL against Ohvara, and none did.
-- On this computer only, `npm run test:sql` replays every migration into an in-memory PGlite,
-- which is a stand-in.

-- ── 1. Guard and preflight ──────────────────────────────────────────────────
do $$
declare
  v_deal  regprocedure := to_regprocedure('public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)');
  v_dupes bigint;
begin
  if to_regclass('public.policy_servicing_status') is null then
    raise exception '212 needs 193_servicing_model applied first. Nothing was changed.';
  end if;
  if to_regclass('public.servicing_task_notes') is null then
    raise exception '212 needs 195_servicing_functions applied first. Nothing was changed.';
  end if;
  if v_deal is null or position('agent_products' in pg_get_functiondef(v_deal)) = 0 then
    raise exception '212 needs 201_agent_products applied first. Nothing was changed.';
  end if;
  if to_regprocedure('public.va_servicing_queue()') is null then
    raise exception '212 needs 206_va_servicing applied first. Nothing was changed.';
  end if;
  -- This file carries 209's feed. Applied the other way round, 209 would put 12 rows per
  -- deal back on Activity.
  if to_regprocedure('public.log_policy_lapsed()') is null then
    raise exception '212 needs 209_activity_lapse_events applied first. Nothing was changed.';
  end if;
  if to_regprocedure('public.set_inbound_outcome(uuid, text, text, timestamptz, text)') is not null then
    raise exception '212 stopped: set_inbound_outcome has 210''s five arguments, and this file''s three next to them would make every call ambiguous. Nothing was changed.';
  end if;

  select count(*) into v_dupes
    from (
      select 1 from public.servicing_tasks
       where policy_id is not null and requested_by = 'system'
         and kind in ('packet_check', 'review_call', 'chargeback_watch')
       group by policy_id, kind having count(*) > 1
    ) d;
  if v_dupes > 0 then
    raise exception '212 stopped: system steps already repeat on % policy and kind pairs. Nothing was changed and no row was deleted.', v_dupes;
  end if;
end $$;

-- ── 2. Settings ─────────────────────────────────────────────────────────────
alter table public.app_settings
  add column servicing_packet_check_days integer not null default 3 check (servicing_packet_check_days >= 0),
  add column servicing_review_call_days integer not null default 10 check (servicing_review_call_days >= 0),
  add column servicing_month_check_window_days integer not null default 7 check (servicing_month_check_window_days >= 0);

comment on column public.app_settings.servicing_packet_check_days is 'Days from the anchor to a new client''s packet check.';
comment on column public.app_settings.servicing_review_call_days is 'Days from the anchor to a new client''s review call.';
comment on column public.app_settings.servicing_month_check_window_days is 'How many days ahead a VA sees a monthly payment check in the queue.';

-- ── 3. servicing_tasks.watch_month ──────────────────────────────────────────
alter table public.servicing_tasks
  add column watch_month smallint,
  add constraint servicing_tasks_watch_month_check check (
    watch_month is null or (watch_month between 1 and 12 and kind = 'chargeback_watch')
  );

comment on column public.servicing_tasks.watch_month is
  'Which month of the 12 this payment check is. Only on chargeback_watch; null on an old unnumbered row.';
comment on table public.servicing_tasks is
  'Every servicing step and every request on a client. Written only by servicing_seed_steps (called by agent_submit_deal and set_inbound_outcome), agent_submit_service_request, fulfillment_schedule_request, fulfillment_finish_request, the va_servicing_* functions, agent_servicing_clear_sent and the service role. A request doesn''t count against the weekly cap.';

-- ── 4. Indexes ──────────────────────────────────────────────────────────────
-- 180's index on (lead_id, kind) would keep 1 of the 12 watch rows through on conflict do
-- nothing. The coalesce is required: packet_check and review_call have a null month and
-- Postgres treats nulls as different, so a plain month column would let a second Sold double
-- those steps.
drop index public.servicing_tasks_sold_seed_uidx;

create unique index servicing_tasks_seed_lead_uidx
  on public.servicing_tasks (lead_id, kind, coalesce(watch_month, 0))
  where requested_by = 'system' and kind in ('packet_check', 'review_call', 'chargeback_watch') and lead_id is not null;

create unique index servicing_tasks_seed_policy_uidx
  on public.servicing_tasks (policy_id, kind, coalesce(watch_month, 0))
  where requested_by = 'system' and kind in ('packet_check', 'review_call', 'chargeback_watch') and policy_id is not null;

-- ── 5. The owner ────────────────────────────────────────────────────────────
alter table public.policies
  add column servicing_va_id uuid references public.profiles(id) on delete set null,
  add column servicing_va_assigned_at timestamptz;

comment on column public.policies.servicing_va_id is
  'The servicing VA. This VA owns the client thread. Not the call rep, which is assigned_fulfillment_id.';
comment on column public.policies.servicing_va_assigned_at is 'When servicing_va_id was set.';

-- fulfillment_pick_rep's side and role rules, counting each VA's live clients. Fewest first,
-- then the longest since their last new client, then id.
create or replace function public.servicing_va_pick(p_policy uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_va uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('servicing_va_pick', 0));

  with side as (select public.policy_is_demo(p_policy) as demo),
  reps as (
    select id from profiles, side
    where role = 'fulfillment' and is_active
      and is_demo = side.demo
  ),
  stats as (
    select r.id,
      count(po.id) as load,
      max(po.servicing_va_assigned_at) as last_assigned
    from reps r
    left join policies po
      on po.servicing_va_id = r.id
     and po.archived_at is null
     and po.status not in ('Lapsed', 'Not Approved', 'Undrafted')
    group by r.id
  )
  select id into v_va from stats
  order by load,
           last_assigned nulls first,
           id
  limit 1;

  return v_va;
end;
$$;
revoke all on function public.servicing_va_pick(uuid) from public, anon, authenticated;

-- ── 6. The shared seed ──────────────────────────────────────────────────────
-- p_lead or p_policy can be null, not both. Safe to run again: it adds what is missing and
-- never changes a row or an owner. See THE ANCHOR and OLD CLIENTS above.
create or replace function public.servicing_seed_steps(
  p_agent     uuid,
  p_policy    uuid,
  p_lead      uuid,
  p_best_time text,
  p_actor     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet_days integer;
  v_review_days integer;
  v_anchor      date := current_date;
  v_best        text := p_best_time;
  v_owner       uuid;
  v_va          uuid;
begin
  select servicing_packet_check_days, servicing_review_call_days
    into v_packet_days, v_review_days
    from app_settings where id = 1;
  if not found then
    raise exception 'The servicing settings are missing (app_settings row 1)' using errcode = 'P0002';
  end if;

  if p_policy is not null then
    select coalesce(effective_date, policy_sold_date, created_at::date), coalesce(p_best_time, best_time), servicing_va_id
      into v_anchor, v_best, v_owner
      from policies where id = p_policy;
  end if;

  insert into servicing_tasks (agent_id, lead_id, policy_id, kind, status, due_at, best_time, requested_by, requested_by_id)
  values (p_agent, p_lead, p_policy, 'packet_check', 'scheduled', ((v_anchor + v_packet_days) + time '12:00') at time zone 'UTC', null,   'system', p_actor),
         (p_agent, p_lead, p_policy, 'review_call',  'scheduled', ((v_anchor + v_review_days) + time '12:00') at time zone 'UTC', v_best, 'system', p_actor)
  on conflict do nothing;

  if not exists (
    select 1 from servicing_tasks
     where requested_by = 'system' and kind = 'chargeback_watch'
       and (lead_id = p_lead or policy_id = p_policy)
  ) then
    insert into servicing_tasks (agent_id, lead_id, policy_id, kind, status, due_at, watch_month, requested_by, requested_by_id)
    select p_agent, p_lead, p_policy, 'chargeback_watch', 'scheduled',
           ((v_anchor + make_interval(months => n))::date + time '12:00') at time zone 'UTC', n::smallint, 'system', p_actor
      from generate_series(1, 12) n
    on conflict do nothing;
  end if;

  -- See WHAT THE OWNER UPDATE TOUCHES above. The where clause holds if a second seed on this
  -- policy got here first.
  if p_policy is not null and v_owner is null then
    v_va := public.servicing_va_pick(p_policy);
    if v_va is not null then
      update policies
         set servicing_va_id = v_va, servicing_va_assigned_at = clock_timestamp()
       where id = p_policy and servicing_va_id is null;
    end if;
  end if;
end;
$$;
revoke all on function public.servicing_seed_steps(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ── 7. policies_servicing_guard ─────────────────────────────────────────────
-- 187, with the owner columns held like replaced_old_policy. An agent or VA can't write
-- them directly; the seed runs as the owner, so it can. The trigger itself stays.
create or replace function public.policies_servicing_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.replaced_old_policy := null;
      new.servicing_va_id := null;
      new.servicing_va_assigned_at := null;
    else
      new.replaced_old_policy := old.replaced_old_policy;
      new.servicing_va_id := old.servicing_va_id;
      new.servicing_va_assigned_at := old.servicing_va_assigned_at;
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

-- ── 8. agent_submit_deal ────────────────────────────────────────────────────
-- 201, with the duplicate lookup and the seed call. Same signature and grants.
create or replace function public.agent_submit_deal(
  p_first          text,
  p_last           text,
  p_phone          text,
  p_city           text,
  p_state          text,
  p_timezone       text,
  p_new_carrier    uuid,
  p_policy_number  text default null,
  p_replaced       boolean default null,
  p_old_carrier    uuid default null,
  p_at             timestamptz default null,
  p_best_time      text default null,
  p_sms_consent    boolean default false,
  p_effective_date date default null
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

  -- The same policy number and new carrier again is a retry. See RESUBMIT in the header.
  if nullif(btrim(p_policy_number), '') is not null then
    select id into v_id
      from policies
     where agent_id = v_agent
       and new_carrier_id = p_new_carrier
       and archived_at is null
       and lower(btrim(policy_number)) = lower(btrim(p_policy_number))
     order by created_at, id
     limit 1;
    if found then
      return v_id;
    end if;
  end if;

  select * into u from public.agent_products(v_agent);
  if found and u.enforced and u.at_limit then
    raise exception '%', u.usage_text
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
    pending_underwriting, fulfillment_assigned, fulfillment_stage, scheduled_call_at, sms_consent, effective_date
  ) values (
    v_agent, 'Submitted', v_first, v_last, v_phone, v_city, v_state, v_tz,
    case when p_replaced then p_old_carrier end, case when p_replaced then v_old_name end,
    p_new_carrier, v_new_name, nullif(btrim(p_policy_number), ''), p_replaced, p_best_time,
    false, true, 'Pending', case when p_replaced then p_at end, coalesce(p_sms_consent, false), p_effective_date
  )
  returning id into v_id;

  -- Having this row keeps Fulfillment's "No intake details" warning from firing.
  insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
  values (v_id, v_first || ' ' || v_last, case when p_replaced then v_old_name end);

  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (v_id, v_agent, 'submitted', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Submitted for servicing', 'replaced', p_replaced,
                             'best_time', p_best_time, 'scheduled_call_at', case when p_replaced then p_at end));

  perform public.servicing_seed_steps(v_agent, v_id, null, p_best_time, v_agent);

  return v_id;
end;
$$;

revoke all on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) from public, anon;
grant execute on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) to authenticated;

-- ── 9. set_inbound_outcome ──────────────────────────────────────────────────
-- 193, with the seed call. Same signature and grants. A Sold can have no policy: the lead
-- index covers it, and it gets no owner.
create or replace function public.set_inbound_outcome(p_lead uuid, p_outcome text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_lead  record;
  v_stage text;
  v_name  text;
  v_role  text;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if p_outcome is null or p_outcome not in ('sold', 'follow_up', 'not_interested') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters' using errcode = '22023';
  end if;

  select id, lead_type, assigned_rep_id, inbound_stage, client_policy_id into v_lead
    from leads where id = p_lead
    for update;
  if not found or not coalesce((
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ), false) then
    if not found and public.is_admin() then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'This is not an inbound lead' using errcode = '22023';
  end if;
  if p_outcome = 'sold' and v_lead.assigned_rep_id is null then
    raise exception 'Give the lead to an agent before marking it sold' using errcode = '22023';
  end if;

  v_stage := case p_outcome when 'sold' then 'sold' when 'follow_up' then 'follow_up' else 'lost' end;

  update leads
     set outcome = p_outcome, outcome_at = now(), outcome_by = v_uid, inbound_stage = v_stage
   where id = p_lead;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'outcome',
          case p_outcome when 'sold' then 'Sold' when 'follow_up' then 'Follow up' else 'Not interested' end,
          jsonb_build_object('outcome', p_outcome, 'from_stage', v_lead.inbound_stage)
            || case when v_note is not null then jsonb_build_object('note', v_note) else '{}'::jsonb end,
          v_uid, v_name, v_role);

  if p_outcome = 'sold' then
    perform public.servicing_seed_steps(v_lead.assigned_rep_id, v_lead.client_policy_id, p_lead, null, v_uid);

    insert into inbound_events (lead_id, agent_id, kind, label, actor_id, actor_name, actor_role)
    values (p_lead, v_lead.assigned_rep_id, 'became_client', 'Became a client', v_uid, v_name, v_role)
    on conflict do nothing;
  end if;

  return v_stage;
end;
$$;

revoke execute on function public.set_inbound_outcome(uuid, text, text) from public, anon;
grant execute on function public.set_inbound_outcome(uuid, text, text) to authenticated;

-- ── 10. The queue and the claim ─────────────────────────────────────────────
-- 206, each with the window read and one line in its WHERE. A refused claim falls through
-- to the existing 22023.
create or replace function public.va_servicing_queue()
returns table (
  task_id          uuid,
  policy_id        uuid,
  lead_id          uuid,
  kind             text,
  status           text,
  requested_by     text,
  due_at           timestamptz,
  best_time        text,
  outcome          text,
  client_name      text,
  client_state     text,
  carrier          text,
  agent_name       text,
  mine             boolean,
  claim_expires_at timestamptz,
  client_phone     text,
  note             text,
  agent_reply_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_window integer;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the servicing queue' using errcode = '42501';
  end if;
  select servicing_month_check_window_days into v_window from app_settings where id = 1;
  if not found then
    raise exception 'The servicing settings are missing (app_settings row 1)' using errcode = 'P0002';
  end if;

  return query
  select t.id, t.policy_id, t.lead_id, t.kind, t.status, t.requested_by, t.due_at, t.best_time, t.outcome,
         coalesce(nullif(btrim(concat_ws(' ', p.client_first_name, p.client_last_name)), ''),
                  nullif(btrim(l.contact_name), ''),
                  nullif(btrim(l.business_name), '')),
         coalesce(p.state, l.state),
         coalesce(p.new_carrier_name, p.carrier_name),
         a.full_name,
         m.mine,
         case when m.mine then t.va_claim_expires_at end,
         case when m.mine then coalesce(p.client_phone, l.phone) end,
         case when m.mine then t.note end,
         case when m.mine then t.agent_reply_note end
    from servicing_tasks t
    left join policies p on p.id = t.policy_id
    left join leads l on l.id = t.lead_id
    left join profiles a on a.id = t.agent_id
   cross join lateral (
     select coalesce(t.va_claimed_by = v_uid and t.va_claim_expires_at > now(), false) as mine
   ) m
   where t.status in ('requested', 'scheduled', 'in_progress')
     and t.sent_to_agent_at is null
     and not (t.status = 'scheduled' and t.watch_month is not null and t.due_at > now() + make_interval(days => v_window))
     and (t.va_claimed_by is null
          or t.va_claimed_by = v_uid
          or t.va_claim_expires_at is null
          or t.va_claim_expires_at <= now())
     and public.servicing_task_is_demo_side(t.id) = public.my_is_demo()
   order by t.due_at asc nulls last, t.created_at, t.id;
end;
$$;
revoke all on function public.va_servicing_queue() from public, anon;
grant execute on function public.va_servicing_queue() to authenticated;

create or replace function public.va_servicing_claim(p_task uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_until timestamptz;
  v_window integer;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take a step' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;
  select servicing_month_check_window_days into v_window from app_settings where id = 1;
  if not found then
    raise exception 'The servicing settings are missing (app_settings row 1)' using errcode = 'P0002';
  end if;

  update servicing_tasks t
     set va_claimed_by = v_uid,
         va_claim_expires_at = now() + interval '15 minutes',
         status = 'in_progress'
   where t.id = p_task
     and t.status in ('requested', 'scheduled', 'in_progress')
     and t.sent_to_agent_at is null
     and not (t.status = 'scheduled' and t.watch_month is not null and t.due_at > now() + make_interval(days => v_window))
     and public.servicing_task_is_demo_side(t.id) = public.my_is_demo()
     and (t.va_claimed_by is null
          or t.va_claimed_by = v_uid
          or t.va_claim_expires_at is null
          or t.va_claim_expires_at <= now())
  returning t.va_claim_expires_at into v_until;

  if v_until is null then
    if public.servicing_task_is_demo_side(p_task) is distinct from public.my_is_demo() then
      raise exception 'Step not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from servicing_tasks
                where id = p_task and va_claimed_by <> v_uid and va_claim_expires_at > now()) then
      raise exception 'Another VA is on this step' using errcode = '55006';
    end if;
    raise exception 'This step is not in the queue' using errcode = '22023';
  end if;
  return v_until;
end;
$$;
revoke all on function public.va_servicing_claim(uuid) from public, anon;
grant execute on function public.va_servicing_claim(uuid) to authenticated;

-- ── 11. agent_activity_feed ─────────────────────────────────────────────────
-- 209, its newest version, with one line added to the servicing_added branch, so month 1
-- stands for the watch and a deal still shows three added rows. All else is 209's.
create or replace function public.agent_activity_feed(
  p_from timestamptz,
  p_to timestamptz,
  p_agent uuid default null,
  p_limit int default 1000
)
returns table (id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_agents uuid[] := '{}';
begin
  select pr.role::text into v_role
    from profiles pr
   where pr.id = v_uid and pr.is_active;

  if v_role is null or v_role not in ('admin', 'agent', 'fulfillment') then
    return;
  end if;

  if v_role = 'agent' then
    v_agents := array(select v_uid union select d.id from public.downline_of(v_uid) d);
  end if;

  return query
  with lead_rows as (
    select l.id as lead_id, l.lead_type, l.state, l.created_at, l.delivered_at,
           coalesce(l.assigned_rep_id, l.transfer_agent_id) as lead_agent,
           coalesce(l.transfer_agent_id, l.assigned_rep_id) as transfer_agent,
           l.transfer_status, l.transferred_at,
           l.va_outcome, l.va_attempts, l.va_callback_at, l.va_last_worked_by, l.va_last_worked_at,
           l.booking_id, coalesce(l.client_policy_id, l.booking_id) as policy_id,
           split_part(n.full_name, ' ', 1) as first_name,
           nullif(btrim(substr(n.full_name, length(split_part(n.full_name, ' ', 1)) + 1)), '') as last_name
      from leads l
     cross join lateral (
       select coalesce(nullif(btrim(l.contact_name), ''), btrim(l.business_name)) as full_name
     ) n
     where l.lead_type <> 'cancellation'
  ),
  policy_lead as (
    select distinct on (x.policy_id) x.policy_id, x.lead_id
      from (
        select lr.booking_id as policy_id, lr.lead_id from lead_rows lr where lr.booking_id is not null
        union all
        select lr.policy_id, lr.lead_id from lead_rows lr where lr.policy_id is not null
      ) x
     order by x.policy_id, x.lead_id
  ),
  events as (
    -- policy_events: booked, moved, no_answer, in_progress, edited, reassigned,
    -- cancelled, and a corrected result as outcome.
    select 'policy_event:' || pe.id::text as id,
           case when pe.detail ->> 'correction' = 'true' then 'outcome' when pe.kind = 'submitted' then 'servicing' else pe.kind end as kind,
           pe.at as at,
           pl.lead_id as lead_id,
           p.agent_id as agent_id,
           case when p.fulfillment_assigned then p.assigned_fulfillment_id end as pool_rep,
           case
             when pe.detail ->> 'correction' = 'true' and pe.kind = 'cancelled' then 'Call result corrected to Cancelled.'
             when pe.detail ->> 'correction' = 'true' then 'Call result corrected to No-show.'
             when pe.kind = 'booked' and pe.from_status is not null then 'Call booked again.'
             when pe.kind = 'booked' then 'Call booked.'
             when pe.kind = 'moved' then 'Booked call moved to a new time.'
             when pe.kind = 'no_answer' then 'No-show: the call ended with no answer.'
             when pe.kind = 'in_progress' then 'A call started.'
             when pe.kind = 'edited' then 'Booking details changed.'
             when pe.kind = 'reassigned' then 'Call given to another Fulfillment rep.'
             when pe.kind = 'cancelled' then 'Old policy confirmed cancelled.'
             when pe.kind = 'submitted' then 'Submitted for servicing'
             when pe.kind = 'servicing' then pe.detail ->> 'label'
             when pe.kind = 'lapsed' then 'Policy lapsed. Payments stopped.'
             else 'Call updated.'
           end as title,
           p.id as policy_id,
           p.client_first_name as first_name,
           p.client_last_name as last_name,
           p.state as state,
           pe.actor_name as actor_name,
           pe.actor_role as actor_role,
           pe.detail -> 'attempt' as attempt,
           pe.detail ->> 'reason' as reason,
           case when pe.kind = 'moved' then pe.detail ->> 'from' end as from_at,
           case pe.kind when 'moved' then pe.detail ->> 'to'
                        when 'booked' then pe.detail ->> 'scheduled_call_at' end as to_at,
           null::text as raw_text,
           case
             when pe.detail ->> 'correction' = 'true' then
               jsonb_build_object('result_from', pe.detail ->> 'from', 'result_to', pe.kind)
             when pe.kind = 'edited' then
               jsonb_build_object('changed_fields', (
                 select jsonb_agg(c ->> 'field')
                   from jsonb_array_elements(
                     case when jsonb_typeof(pe.detail -> 'changes') = 'array' then pe.detail -> 'changes' else '[]'::jsonb end
                   ) c
               ))
             when pe.kind = 'reassigned' then
               jsonb_build_object('from_name', pe.detail ->> 'from_name', 'to_name', pe.detail ->> 'to_name')
             else '{}'::jsonb
           end as extra
      from policy_events pe
      join policies p on p.id = pe.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where pe.at >= p_from and pe.at < p_to
       and pe.kind <> 'service_request'
       and not (pe.kind = 'servicing' and pe.detail ->> 'action' = 'done')

    union all
    -- inbound
    select 'lead_inbound:' || lr.lead_id::text, 'inbound', coalesce(lr.delivered_at, lr.created_at),
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.lead_type when 'policy_help' then 'A new live call came in.'
                             when 'mortgage_protection' then 'A new appointment request came in.'
                             else 'A new lead came in.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, null, null, null, null, null, null, '{}'::jsonb
      from lead_rows lr
     where coalesce(lr.delivered_at, lr.created_at) >= p_from
       and coalesce(lr.delivered_at, lr.created_at) < p_to

    union all
    -- text_auto
    select 'followup_sms:' || s.id::text, 'text_auto', s.created_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case when s.stage = 'just_submitted' then 'Welcome text sent automatically.'
                else 'Automatic follow-up text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, s.stage, null, null, null, '{}'::jsonb
      from lead_followup_sms_log s
      join lead_rows lr on lr.lead_id = s.lead_id
     where s.status = 'sent'
       and s.created_at >= p_from and s.created_at < p_to

    union all
    -- text_auto: the booked-call texts. Confirmed sends only: ok with nothing skipped.
    select 'recovery_sms:' || rs.id::text, 'text_auto', rs.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           case rs.kind when 'text1' then 'Automatic text sent after a missed call.'
                        when 'text2' then 'Automatic reminder text sent about the next call.'
                        when 'am' then 'Automatic text sent after a missed call.'
                        when 'pm' then 'Automatic text sent after a missed call.'
                        when 'apology1' then 'Automatic apology text sent for a missed call.'
                        when 'apology2' then 'Automatic reminder text sent about the next call.'
                        when 'confirm' then 'Automatic confirmation text sent.'
                        else 'Automatic text sent.' end,
           p.id, p.client_first_name, p.client_last_name, p.state,
           null, 'system', null, rs.kind, null, null, null, '{}'::jsonb
      from recovery_sms_log rs
      join policies p on p.id = rs.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where rs.ok and rs.skipped is null
       and rs.created_at >= p_from and rs.created_at < p_to

    union all
    -- text_auto: lead-workflow-sms steps. It marks a row done before it sends, so
    -- only a row holding Twilio's answer is known to have gone out.
    select 'inbound_event:' || ev.id::text, 'text_auto', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case when ev.detail ->> 'step' = 'instant' then 'Welcome text sent automatically.'
                when ev.detail ->> 'step' like 'not_reached%' then 'Automatic follow-up text sent.'
                when ev.detail ->> 'step' = 'confirm' then 'Automatic confirmation text sent.'
                when ev.detail ->> 'step' like 'reminder%' then 'Automatic reminder text sent.'
                when ev.detail ->> 'step' = 'no_show_rebook' then 'Automatic rebook text sent.'
                else 'Automatic text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, ev.detail ->> 'step', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind in ('text_sent', 'reminder')
       and ev.state = 'done'
       and nullif(ev.detail ->> 'twilio_sid', '') is not null
       and ev.at >= p_from and ev.at < p_to

    union all
    -- text_reply: a client's text to a lead
    select 'sms_reply:' || r.id::text, 'text_reply', r.received_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           'The client replied by text.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'client', null, null, null, null, r.body, '{}'::jsonb
      from lead_sms_replies r
      join lead_rows lr on lr.lead_id = r.lead_id
     where r.received_at >= p_from and r.received_at < p_to

    union all
    -- text_reply: a message sent to the agent on a client's thread
    select 'policy_message:' || m.id::text, 'text_reply', m.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           'New message on this client''s thread.',
           p.id, p.client_first_name, p.client_last_name, p.state,
           m.sender_name, m.sender_role, null, null, null, null, m.body, '{}'::jsonb
      from policy_messages m
      join policies p on p.id = m.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where m.sender_id <> p.agent_id
       and p.fulfillment_assigned
       and m.created_at >= p_from and m.created_at < p_to

    union all
    -- va_call
    select 'va_call:' || lr.lead_id::text, 'va_call', lr.va_last_worked_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.va_outcome when 'not_reached' then 'A VA called and did not reach the client.'
                              when 'callback' then 'A VA called and set a callback.'
                              else 'A VA called and the client is not interested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), lr.va_outcome,
           null, case when lr.va_outcome = 'callback' then to_jsonb(lr.va_callback_at) #>> '{}' end, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome in ('not_reached', 'callback', 'not_interested')
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'va_call' and x.state = 'done')

    union all
    -- va_call: one row per attempt, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'va_call', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case ev.detail ->> 'outcome' when 'not_reached' then 'A VA called and did not reach the client.'
                                        when 'callback' then 'A VA called and set a callback.'
                                        when 'not_interested' then 'A VA called and the client is not interested.'
                                        else 'A VA called.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, ev.detail -> 'attempt', ev.detail ->> 'outcome',
           null, ev.detail ->> 'callback_at', null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'va_call'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- booked: a VA's booking with no policy row to log it
    select 'lead_booked:' || lr.lead_id::text, 'booked', lr.va_last_worked_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           'A VA booked an appointment.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), null, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome = 'booked'
       and lr.booking_id is null
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to

    union all
    -- transferred
    select 'lead_transfer:' || lr.lead_id::text, 'transferred', lr.transferred_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           case lr.transfer_status when 'connected' then 'A live transfer connected.'
                                   when 'dropped' then 'A live transfer dropped.'
                                   else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, null, lr.transfer_status, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.transferred_at >= p_from and lr.transferred_at < p_to
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'transferred' and x.state = 'done')

    union all
    -- transferred: one row per change, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'transferred', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.transfer_agent), null::uuid,
           case ev.detail ->> 'status' when 'connected' then 'A live transfer connected.'
                                       when 'dropped' then 'A live transfer dropped.'
                                       else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'status', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'transferred'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- outcome and sold: the agent's Sold / Follow up / Not interested
    select 'inbound_event:' || ev.id::text,
           case when ev.detail ->> 'outcome' = 'sold' then 'sold' else 'outcome' end,
           ev.at, lr.lead_id, lr.lead_agent, null::uuid,
           case ev.detail ->> 'outcome' when 'sold' then 'Marked sold. The lead is now a client.'
                                        when 'follow_up' then 'Outcome marked: follow up.'
                                        when 'not_interested' then 'Outcome marked: not interested.'
                                        else 'Outcome marked.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'outcome', null, null, ev.detail ->> 'note', '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'outcome'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- servicing: the task was added
    select 'servicing_added:' || t.id::text, 'servicing', t.created_at,
           t.lead_id, t.agent_id, null::uuid,
           case when t.kind = 'lapse_save' then 'Lapse risk flagged.'
                when t.requested_by in ('agent', 'client') then 'Request opened: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task added: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           rb.full_name, rb.role::text, null, t.kind, null, to_jsonb(t.due_at) #>> '{}', t.note, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
      left join profiles rb on rb.id = t.requested_by_id
     where t.created_at >= p_from and t.created_at < p_to
       and coalesce(t.watch_month, 1) = 1

    union all
    -- servicing: the task was done
    select 'servicing_done:' || t.id::text, 'servicing', t.done_at,
           t.lead_id, t.agent_id, null::uuid,
           case when t.kind = 'lapse_save' then
                  case t.outcome when 'saved' then 'Policy saved from lapse.'
                                 when 'lapsed' then 'Policy lapsed.'
                                 when 'client_cancelled' then 'The client cancelled the policy.'
                                 else 'Lapse work done.' end
                when t.requested_by in ('agent', 'client') then 'Request done: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task done: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           null, null, null, t.outcome, null, null, null, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
     where t.done_at >= p_from and t.done_at < p_to

    union all
    -- billing_spend_*: one log row is one feed row, and a row that changed nothing is none.
    select 'spend_log:' || sl.id::text,
           case when sl.old_paused is distinct from sl.new_paused then 'billing_spend_pause' else 'billing_spend_change' end,
           sl.created_at, null, sl.agent_id, null::uuid,
           case when sl.old_paused is not distinct from sl.new_paused then 'Weekly lead spend changed.'
                when sl.new_paused then 'Lead spend paused.'
                else 'Lead spend resumed.' end,
           null, null, null, null, null, null, null,
           case when sl.old_paused is not distinct from sl.new_paused then null
                when sl.new_paused then 'paused'
                else 'resumed' end,
           null, null, null,
           jsonb_build_object('inbound_type', sl.inbound_type)
             || case when sl.old_paused is distinct from sl.new_paused and sl.old_cents = sl.new_cents then '{}'::jsonb
                     else jsonb_build_object('amount_cents', sl.new_cents) end
      from agent_inbound_spend_log sl
     where sl.created_at >= p_from and sl.created_at < p_to
       and (sl.old_paused is distinct from sl.new_paused or sl.old_cents is distinct from sl.new_cents)
  )
  select e.id, e.kind, e.at, e.lead_id, e.agent_id, e.title,
         jsonb_strip_nulls(jsonb_build_object(
           'policy_id', e.policy_id,
           'client_first_name', case when e.first_name !~ '[0-9]' then e.first_name end,
           'client_last_name', case when e.last_name !~ '[0-9]' then e.last_name end,
           'state', e.state,
           'actor_name', e.actor_name,
           'actor_role', e.actor_role,
           'attempt', e.attempt,
           'reason', e.reason,
           'from', e.from_at,
           'to', e.to_at,
           'preview', left(regexp_replace(e.raw_text, '\+?\(?[0-9][0-9[:space:]().-]{5,}[0-9]', '[number removed]', 'g'), 140)
         ) || e.extra)
    from events e
   where (v_role = 'admin'
          or (v_role = 'agent' and e.agent_id = any (v_agents))
          or (v_role = 'fulfillment' and e.pool_rep = v_uid))
     and (e.kind not in ('billing_spend_change', 'billing_spend_pause') or v_role = 'admin' or e.agent_id = v_uid)
     and (p_agent is null or e.agent_id = p_agent)
   order by e.at desc, e.id desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 0);
end;
$$;

revoke execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) to authenticated;

-- Check after applying:
--   select count(*) from pg_indexes where indexname = 'servicing_tasks_sold_seed_uidx';  -- 0
--   select count(*) from public.servicing_tasks where watch_month is not null;           -- 0
--   select count(*) from public.policies where servicing_va_id is not null;              -- 0
