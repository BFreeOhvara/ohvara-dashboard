-- agent_products: one place that says what an agent has, Servicing plan, Leads
-- spend, both or neither, and how much of this week's limit is used. Submit's limit
-- and the policies trigger read it. Plan sizes and prices come from the
-- agent_billing_tiers rows, so a change there needs no code change.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. Apply
-- after 188_inbound_spend, 193_servicing_model and 195_servicing_functions: the first
-- statement stops the whole file unless 195's agent_submit_deal, with its weekly cap
-- check, and 188's agent_inbound_spend are there. It cannot follow
-- 192_submit_no_weekly_cap, which removes the cap this file keeps.
--
-- Nothing is repriced and nothing is removed: no row in agent_billing_tiers or
-- app_settings changes, no Stripe change, no function under supabase/functions.
-- submit_live and every live switch stay as they are.
--
-- What changes:
--   agent_billing_tiers.price_is_test  new column, default true: every price on these
--     rows is a test value until Brayden sets a real one. The rows are the Servicing
--     plans again, reversing 188's "the app stops using the tiers".
--   agent_week_bounds(p_tz, p_at)      new. Monday 00:00 to next Monday 00:00 on that
--     clock, so a clock-change week still ends at midnight.
--   agent_weekly_usage                 copied whole from 131. Only change: its two
--     bound lines read agent_week_bounds. It stays the one place that counts.
--   agent_products(p_agent)            new. Read only. See FRONTEND CONTRACT.
--   agent_submit_deal                  copied whole from 195, same signature. Only
--     change: the cap read uses agent_products, and the refusal says usage_text.
--   enforce_weekly_submission_cap      188 made it a no-op. 147's body is back whole,
--     with its UPDATE branch. Changes from 147: it returns when auth.uid() is not the
--     row's agent, before it reads anything, because a VA inserting for an agent
--     (policies_insert_va, 175) would get 42501 from the usage check; it reads
--     agent_products; and the refusal says usage_text. The trigger itself stays.
--
-- Who is limited (131 and p_submit_servicing b11, not 119's header): a comped agent
-- keeps their tier's cap, non-agents have none, and with agent_billing_enforced off
-- the count and the limit are returned but nothing is refused.
--
-- FRONTEND CONTRACT:
--   rpc agent_products(p_agent default auth.uid())
--     Someone else's id needs admin, else 42501. No row for an unknown profile.
--     has_servicing, plan_key, plan_name, plan_size, weekly_cents, price_is_test,
--     used, weekly_limit, week_start, week_end (the reset time), enforced, at_limit,
--     usage_text, has_leads, leads (array of {type, weekly_cents, paused}, by type).
--     No Servicing: plan and usage columns null, at_limit false, leads still reported.
--     A non-agent role: no products, whatever rows exist.
--     A tier with no cap: weekly_limit null, at_limit false, usage_text has no "of".
--     enforced is true or false in every state.
--   agent_submit_deal, trigger: at the limit they raise usage_text, errcode P0001,
--     hint weekly_cap. Leads-only: 'Servicing is not on your plan', hint no_servicing.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
declare
  v_deal regprocedure := to_regprocedure('public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)');
begin
  if v_deal is null then
    raise exception 'agent_products stopped: agent_submit_deal with p_effective_date is missing, so 195_servicing_functions is not applied. Nothing was changed.';
  end if;
  if position('weekly_cap' in pg_get_functiondef(v_deal)) = 0 then
    raise exception 'agent_products stopped: the current agent_submit_deal has no weekly cap check. This file keeps the cap, so it can''t follow 192_submit_no_weekly_cap. Nothing was changed.';
  end if;
  if to_regclass('public.agent_inbound_spend') is null then
    raise exception 'agent_products stopped: agent_inbound_spend is missing, so 188_inbound_spend is not applied. Nothing was changed.';
  end if;
end $$;

-- ── 2. Plan rows ────────────────────────────────────────────────────────────
alter table public.agent_billing_tiers
  add column if not exists price_is_test boolean not null default true;

comment on table public.agent_billing_tiers is
  'The Servicing plans, reversing 188''s "the app stops using the tiers". Price and weekly submission cap per row; a new plan is a new row. Prices are test values until Brayden sets real ones. agent_products reads these rows. The Stripe Price is created by the agent-billing function and recorded in stripe_price_id.';
comment on column public.agent_billing_tiers.price_is_test is
  'True while weekly_cents is a test value. Brayden sets real prices; nothing flips this on its own.';
comment on column public.app_settings.agent_billing_weekly_cents is
  'The tier rows in agent_billing_tiers are the Servicing plans, and agent_products does not read this column. agent-billing Checkout still does, until Billing goal fe2f2055 moves it. Existing subscriptions keep the price they are on.';

-- ── 3. The week ─────────────────────────────────────────────────────────────
-- The step is on the local timestamp, so a week with a clock change still runs from
-- Monday midnight to Monday midnight on that clock.
create or replace function public.agent_week_bounds(p_tz text, p_at timestamptz default now())
returns table (
  week_start timestamptz,
  week_end   timestamptz
)
language sql
stable
set search_path = public
as $$
  select date_trunc('week', p_at at time zone p_tz) at time zone p_tz,
         (date_trunc('week', p_at at time zone p_tz) + interval '1 week') at time zone p_tz
$$;

revoke all on function public.agent_week_bounds(text, timestamptz) from public, anon;
grant execute on function public.agent_week_bounds(text, timestamptz) to authenticated;

-- ── 4. The one count ────────────────────────────────────────────────────────
-- 131, with its two bound lines reading agent_week_bounds.
create or replace function public.agent_weekly_usage(p_agent uuid default auth.uid())
returns table (
  tier        text,
  tier_name   text,
  weekly_cap  integer,
  used        integer,
  week_start  timestamptz,
  week_end    timestamptz,
  enforced    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_role    text;
  v_status  text;
  v_exempt  boolean;
  v_tier    text;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if p_agent is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select coalesce(timezone, 'America/Chicago'), role, billing_status, billing_exempt, billing_tier
    into v_tz, v_role, v_status, v_exempt, v_tier
  from profiles where id = p_agent;
  if not found then return; end if;

  select b.week_start, b.week_end into v_start, v_end from public.agent_week_bounds(v_tz) b;

  return query
  select
    t.key,
    t.name,
    case when v_role = 'agent' then t.weekly_cap else null end,
    (select count(*)::int from policies po
       where po.agent_id = p_agent and po.fulfillment_assigned
         and po.created_at >= v_start and po.created_at < v_end),
    v_start,
    v_end,
    coalesce((select s.agent_billing_enforced from app_settings s where s.id = 1), false)
  from agent_billing_tiers t
  where t.key = v_tier;
end;
$$;

revoke all on function public.agent_weekly_usage(uuid) from public, anon;
grant execute on function public.agent_weekly_usage(uuid) to authenticated;

-- ── 5. What an agent has ────────────────────────────────────────────────────
-- Servicing none is profiles.has_servicing false (187). The plan is the billing_tier
-- row, used only when has_servicing is true and the role is agent. Spend of 0 means
-- none (188); a paused row above 0 still counts. It adds no second count: used, the
-- limit, the week and enforced all come from agent_weekly_usage.
create or replace function public.agent_products(p_agent uuid default auth.uid())
returns table (
  has_servicing boolean,
  plan_key      text,
  plan_name     text,
  plan_size     integer,
  weekly_cents  integer,
  price_is_test boolean,
  used          integer,
  weekly_limit  integer,
  week_start    timestamptz,
  week_end      timestamptz,
  enforced      boolean,
  at_limit      boolean,
  usage_text    text,
  has_leads     boolean,
  leads         jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role      text;
  v_servicing boolean;
  v_tz        text;
  v_day       text;
  u           record;
begin
  if p_agent is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select p.role, p.has_servicing, coalesce(p.timezone, 'America/Chicago')
    into v_role, v_servicing, v_tz
    from profiles p where p.id = p_agent;
  if not found then return; end if;

  select * into u from public.agent_weekly_usage(p_agent);

  enforced      := coalesce(u.enforced, false);
  has_servicing := false;
  at_limit      := false;
  has_leads     := false;
  leads         := '[]'::jsonb;

  if v_role is distinct from 'agent' then
    return next;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', s.inbound_type, 'weekly_cents', s.weekly_cents, 'paused', s.paused)
                            order by s.inbound_type), '[]'::jsonb)
    into leads
    from agent_inbound_spend s
   where s.agent_id = p_agent and s.weekly_cents > 0;
  has_leads := jsonb_array_length(leads) > 0;

  if v_servicing then
    has_servicing := true;
    select t.key, t.name, t.weekly_cap, t.weekly_cents, t.price_is_test
      into plan_key, plan_name, plan_size, weekly_cents, price_is_test
      from agent_billing_tiers t where t.key = u.tier;
    used         := u.used;
    weekly_limit := u.weekly_cap;
    week_start   := u.week_start;
    week_end     := u.week_end;
    at_limit     := u.weekly_cap is not null and u.used >= u.weekly_cap;
    v_day        := to_char(u.week_end at time zone v_tz, 'FMDay');
    usage_text   := case when u.weekly_cap is null
                         then format('%s used this week, resets %s', u.used, v_day)
                         else format('%s of %s used this week, resets %s', u.used, u.weekly_cap, v_day)
                    end;
  end if;

  return next;
end;
$$;

revoke all on function public.agent_products(uuid) from public, anon;
grant execute on function public.agent_products(uuid) to authenticated;

comment on function public.agent_products(uuid) is
  'What an agent has: Servicing plan, Leads spend, both or neither, and this week''s limit as used. Read only. Sizes and prices come from agent_billing_tiers; the count comes from agent_weekly_usage.';

-- ── 6. Submit a deal ────────────────────────────────────────────────────────
-- 195, with the cap read on agent_products and usage_text as the refusal. Same
-- signature, so no overload.
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
  v_anchor   date := coalesce(p_effective_date, current_date);
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

  -- Noon UTC is the same calendar day in every US time zone (193), and the watch's
  -- due_at equals the view's watch end.
  insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, best_time, requested_by, requested_by_id)
  values (v_agent, v_id, 'packet_check',     'scheduled', ((v_anchor + 3) + time '12:00') at time zone 'UTC',                         null,        'system', v_agent),
         (v_agent, v_id, 'review_call',      'scheduled', ((v_anchor + 10) + time '12:00') at time zone 'UTC',                        p_best_time, 'system', v_agent),
         (v_agent, v_id, 'chargeback_watch', 'scheduled', ((v_anchor + interval '12 months')::date + time '12:00') at time zone 'UTC', null,        'system', v_agent);

  return v_id;
end;
$$;

revoke all on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) from public, anon;
grant execute on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) to authenticated;

-- ── 7. The weekly limit on every other path ─────────────────────────────────
-- 147's body, which 188 replaced with a no-op, reading agent_products. Same name and
-- signature, so policies_enforce_weekly_cap keeps pointing at it, on insert and on
-- update. A booking counts toward the agent's week when fulfillment_assigned is true
-- and created_at is inside that week. An UPDATE that makes a row start counting
-- (assigned flipped on, moved to another agent, or created_at moved into this week)
-- is checked the same way. Rebooks and time changes don't touch either column, so
-- they never use a booking. Only the agent's own write is refused: a VA booking for
-- the agent still counts toward the week, but it isn't held to the limit here.
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
  if auth.uid() is distinct from new.agent_id then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('weekly_cap:' || new.agent_id::text, 0));

  select * into u from public.agent_products(new.agent_id);
  if not found or not u.enforced or u.weekly_limit is null then return new; end if;

  if tg_op = 'UPDATE' then
    -- Only a row that starts counting for this agent this week can go over.
    if not (new.created_at >= u.week_start and new.created_at < u.week_end) then return new; end if;
    if coalesce(old.fulfillment_assigned, false)
       and old.agent_id is not distinct from new.agent_id
       and old.created_at >= u.week_start and old.created_at < u.week_end then
      return new;
    end if;
  end if;

  if u.at_limit then
    raise exception '%', u.usage_text
      using errcode = 'P0001', hint = 'weekly_cap';
  end if;
  return new;
end;
$function$;
