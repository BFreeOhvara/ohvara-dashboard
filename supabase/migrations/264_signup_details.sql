-- P941 — Setup tickets that make sense. The agent's sign-up collects everything the campaign needs BEFORE the card is
-- charged: 3 to 10 licensed states (no New York) with the "I'm licensed in every state I picked" tick, calendar hours
-- and time zone, live transfers yes/no (with the phone they ring). The Setup ticket shows that sign-up, and the launch
-- checks read in plain words, the same steps on the agent's side.
--
--   1. agent_lead_settings.licensed_at / licensed_states: the licence tick (when, and the states it covered).
--   2. save_signup_details(p): the locked (unpaid) agent saves their details. Checks everything first; one bad field
--      means nothing is saved. Only before the sign-up is paid; afterwards Settings changes them.
--   3. my_signup_details(): what they saved (the sign-up form fills itself back in after a reload or a declined card).
--   4. signup_details_missing(agent): what's still missing. lead-spend's 'signup' action refuses a lead plan until it
--      is empty (service role only).
--   5. agent_launch_facts: licence = the tick (or an NPN, as before) + a 'signup' block for the ticket (plan, daily
--      spend, paid on, the sign-up charge, hours by day, time zone, live transfers).
--   6. agent_launch_checks: seven plain checks, in the ticket's order: paid, states, hours, link, testLead, testCall, app
--      ('profile' split into states + hours). launch_checks_sweep says the broken check in words.
--   7. my_launch_checks(): the agent's own launch checks (their setup progress on Overview).

-- ── 1. The licence tick ─────────────────────────────────────────────────────
alter table public.agent_lead_settings
  add column if not exists licensed_at timestamptz,
  add column if not exists licensed_states text[];
comment on column public.agent_lead_settings.licensed_at is
  'P941: when the agent ticked "I''m licensed for life insurance in every state I picked" (sign-up). Null = not ticked.';
comment on column public.agent_lead_settings.licensed_states is 'P941: the states the licence tick covered.';

-- The pre-payment save is the one writer a locked self-signup agent may use on agent_lead_settings.
create or replace function public.block_locked_self_signup_writer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ohvara.signup_details', true), '') = 'on' then return coalesce(new, old); end if;
  if auth.uid() is not null and public.is_locked_self_signup() then
    raise exception 'Choose a plan to unlock your portal.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end; $$;

-- ── 4. What's missing (also used by 2 and 3) ────────────────────────────────
create or replace function public.signup_details_missing(p_agent uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  p  profiles;
  s  agent_lead_settings;
  n  int;
  miss text[] := '{}';
begin
  select * into p from profiles where id = p_agent;
  if not found then return array['agent']; end if;
  select * into s from agent_lead_settings where agent_id = p_agent;
  n := coalesce(cardinality(s.states), 0);
  if n < 3 or n > 10 or s.states && public.licence_not_taking() then miss := miss || 'states'::text; end if;
  if s.licensed_at is null or not (coalesce(s.states, '{}') <@ coalesce(s.licensed_states, '{}')) then miss := miss || 'licence'::text; end if;
  if p.timezone is null or p.timezone_confirmed_at is null then miss := miss || 'timezone'::text; end if;
  if not exists (select 1 from agent_working_hours h where h.agent_id = p_agent) then miss := miss || 'hours'::text; end if;
  return miss;
end; $$;
revoke execute on function public.signup_details_missing(uuid) from public, anon, authenticated;
grant  execute on function public.signup_details_missing(uuid) to service_role;

-- ── 3. What they saved ──────────────────────────────────────────────────────
create or replace function public.my_signup_details()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p profiles;
  s agent_lead_settings;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into p from profiles where id = auth.uid() and role::text = 'agent';
  if not found then raise exception 'Agents only' using errcode = '42501'; end if;
  select * into s from agent_lead_settings where agent_id = p.id;
  return jsonb_build_object(
    'states', to_jsonb(coalesce(s.states, '{}'::text[])),
    'licensed', s.licensed_at is not null and coalesce(s.states, '{}') <@ coalesce(s.licensed_states, '{}'),
    'licensedAt', s.licensed_at,
    'timezone', case when p.timezone_confirmed_at is not null then p.timezone end,
    'workingHours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'start', to_char(h.start_time, 'HH24:MI'),
                       'end', case when h.end_time = '24:00'::time then '24:00' else to_char(h.end_time, 'HH24:MI') end) order by h.weekday)
                       from agent_working_hours h where h.agent_id = p.id), '[]'::jsonb),
    'liveTransfers', p.live_transfer_phone is not null,
    'phone', p.live_transfer_phone,
    'notTaking', to_jsonb(public.licence_not_taking()),
    'missing', to_jsonb(public.signup_details_missing(p.id))
  );
end; $$;
revoke execute on function public.my_signup_details() from public, anon;
grant  execute on function public.my_signup_details() to authenticated;

-- ── 2. The pre-payment save ─────────────────────────────────────────────────
-- p: { states: ['TX', ...], licensed: true, timezone: 'America/Chicago', working_hours: [{ weekday 1-7, start 'HH:MM',
-- end 'HH:MM' }], live_transfers: bool, live_transfer_phone: '+1...' | null }. Every key is required.
create or replace function public.save_signup_details(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      profiles;
  el      jsonb;
  k       text;
  v_states text[];
  v_day   smallint;
  v_days  smallint[] := '{}';
  v_live  boolean;
  v_phone text;
  v_start time;
  v_end   time;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into me from profiles where id = auth.uid() for update;
  if not found or me.role::text <> 'agent' or not coalesce(me.is_active, false) or me.deleted_at is not null then
    raise exception 'Only an active agent can sign up' using errcode = '42501';
  end if;
  if exists (select 1 from agent_billing_plans b where b.agent_id = me.id and b.setup_paid_at is not null) then
    raise exception 'You''ve already signed up. Change these in Settings.' using errcode = 'P0001', hint = 'already_paid';
  end if;

  -- Check everything first, so one bad field means nothing is saved.
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Details must be a JSON object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('states', 'licensed', 'timezone', 'working_hours', 'live_transfers', 'live_transfer_phone') then
      raise exception 'Unknown detail: %', k using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p -> 'states') is distinct from 'array' then raise exception 'Pick your states' using errcode = '22023'; end if;
  select array_agg(distinct upper(btrim(x)) order by upper(btrim(x))) into v_states from jsonb_array_elements_text(p -> 'states') x;
  v_states := coalesce(v_states, '{}');
  if exists (select 1 from unnest(v_states) s where s !~ '^[A-Z]{2}$') then raise exception 'That isn''t a state' using errcode = '22023'; end if;
  if cardinality(v_states) < 3 or cardinality(v_states) > 10 then
    raise exception 'Pick 3 to 10 states' using errcode = '22023', hint = 'states';
  end if;
  if v_states && public.licence_not_taking() then
    raise exception 'We aren''t taking % yet', (select string_agg(s, ', ') from unnest(v_states) s where s = any (public.licence_not_taking()))
      using errcode = '22023', hint = 'states';
  end if;
  if (p -> 'licensed') is distinct from 'true'::jsonb then
    raise exception 'Tick the box to confirm you''re licensed in every state you picked' using errcode = '22023', hint = 'licence';
  end if;

  if jsonb_typeof(p -> 'timezone') is distinct from 'string' or not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then
    raise exception 'Pick your time zone' using errcode = '22023', hint = 'timezone';
  end if;

  if jsonb_typeof(p -> 'working_hours') is distinct from 'array' or jsonb_array_length(p -> 'working_hours') = 0 then
    raise exception 'Set the hours you take calls' using errcode = '22023', hint = 'hours';
  end if;
  for el in select jsonb_array_elements(p -> 'working_hours') loop
    if jsonb_typeof(el -> 'weekday') is distinct from 'number' or el ->> 'weekday' !~ '^[1-7]$' then
      raise exception 'Each day needs a weekday from 1 to 7' using errcode = '22023';
    end if;
    v_day := (el ->> 'weekday')::smallint;
    if v_day = any (v_days) then raise exception 'That day is listed twice' using errcode = '22023'; end if;
    v_days := v_days || v_day;
    if jsonb_typeof(el -> 'start') is distinct from 'string' or jsonb_typeof(el -> 'end') is distinct from 'string'
       or el ->> 'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or el ->> 'end' !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
      raise exception 'Times must look like 09:00' using errcode = '22023';
    end if;
    if (el ->> 'start')::time >= (el ->> 'end')::time then
      raise exception 'Hours must end after they start. Overnight hours aren''t allowed.' using errcode = '22023', hint = 'hours';
    end if;
  end loop;

  if jsonb_typeof(p -> 'live_transfers') is distinct from 'boolean' then
    raise exception 'Say whether you take live transfers' using errcode = '22023', hint = 'live';
  end if;
  v_live := (p ->> 'live_transfers')::boolean;
  v_phone := case when v_live then p ->> 'live_transfer_phone' end;
  if v_live and (v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Add the phone live transfers ring (like +15125551234)' using errcode = '22023', hint = 'phone';
  end if;

  -- Save. The flag lets this one writer through the locked-sign-up guard on agent_lead_settings (this transaction only).
  perform set_config('ohvara.signup_details', 'on', true);
  insert into agent_lead_settings (agent_id, states, licensed_at, licensed_states, updated_at)
  values (me.id, v_states, now(), v_states, now())
  on conflict (agent_id) do update set states = excluded.states, licensed_at = now(), licensed_states = excluded.licensed_states, updated_at = now();
  perform set_config('ohvara.signup_details', '', true);

  delete from agent_working_hours where agent_id = me.id;
  insert into agent_working_hours (agent_id, weekday, start_time, end_time)
  select me.id, (d.v ->> 'weekday')::smallint, (d.v ->> 'start')::time, (d.v ->> 'end')::time
    from jsonb_array_elements(p -> 'working_hours') d(v);
  select min(start_time), max(end_time) into v_start, v_end from agent_working_hours where agent_id = me.id;

  update profiles set timezone = p ->> 'timezone', timezone_confirmed_at = now(),
         working_hours_start = v_start, working_hours_end = v_end, live_transfer_phone = v_phone
   where id = me.id;

  return public.my_signup_details();
end; $$;
revoke execute on function public.save_signup_details(jsonb) from public, anon;
grant  execute on function public.save_signup_details(jsonb) to authenticated;

-- ── 5. The facts: licence tick + the sign-up block ──────────────────────────
create or replace function public.agent_launch_facts(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p    profiles;
  v_me text;
  s    agent_lead_settings;
  g    record;
  tl   record;
  r    transfer_readiness;
  x    agent_launch;
  b    agent_billing_plans;
  sc   lead_spend_charges;
  v_dev int;
  v_link text;
  v_daily int;
begin
  select * into p from profiles where id = p_agent and role::text = 'agent';
  if not found then return null; end if;
  v_me := coalesce(p.agent_code, p.id::text);
  select * into s from agent_lead_settings where agent_id = p_agent;
  select g0.campaign_id, g0.fb_campaign_id, g0.link_ref into g from ghl_campaign_agents g0
   where g0.agent_id = p_agent order by (coalesce(g0.lead_type, 'appts') = 'appts') desc, g0.mapped_at desc nulls last limit 1;
  v_link := case when g.link_ref is null then null
                 when public.agent_by_ref(g.link_ref) = p_agent then v_me else g.link_ref end;
  -- The test lead: a lead that reached this agent through the link or the campaign; one marked as a test first.
  select i.received_at, i.routing, l.id as lead_id, l.first_call_at, l.first_call_by into tl
    from lead_intake i join leads l on l.id = i.lead_id
   where l.assigned_rep_id = p_agent and i.routing in ('matched', 'campaign')
   order by i.is_test desc, i.received_at desc limit 1;
  select * into r from transfer_readiness where agent_id = p_agent;
  select count(*)::int into v_dev from push_devices where profile_id = p_agent;
  select * into x from agent_launch where agent_id = p_agent;
  select * into b from agent_billing_plans where agent_id = p_agent;
  select * into sc from lead_spend_charges where agent_id = p_agent and kind = 'signup' and status = 'paid' order by updated_at desc limit 1;
  select coalesce(sum(daily_cents), 0)::int into v_daily from agent_lead_spend where agent_id = p_agent;
  return jsonb_build_object(
    'agentRef', v_me,
    'lead', case when p.live_transfer_phone is not null then 'live' else 'appointment' end,
    'states', to_jsonb(coalesce(s.states, '{}'::text[])),
    'launch', jsonb_build_object(
      'linkRef', v_link,
      'campaignId', coalesce(g.fb_campaign_id, g.campaign_id),
      'campaignRef', case when g.campaign_id is not null then v_me end,
      'testLead', case when tl.lead_id is not null then jsonb_build_object('at', tl.received_at, 'matchedRef', v_me,
                    'by', case tl.routing when 'campaign' then 'campaign' else 'link' end, 'leadId', tl.lead_id) end,
      -- P941: the sign-up's licence tick counts (covering every picked state); an NPN still does, as before.
      'licence', (s.licensed_at is not null and coalesce(s.states, '{}') <@ coalesce(s.licensed_states, '{}'))
                 or (p.npn is not null and btrim(p.npn) <> ''),
      'hours', p.working_hours_start, 'tz', p.timezone,
      'card', case when p.billing_status in ('active', 'trialing') then coalesce(b.card_label, 'Card on file') end,
      'cardFailed', case when p.billing_status = 'past_due' then 'past due' end,
      'app', jsonb_build_object('installed', v_dev > 0, 'pushAnswered', r.push_ok_at is not null),
      'testCall', case when tl.first_call_at is not null then jsonb_build_object('at', tl.first_call_at, 'by', upper(coalesce(tl.first_call_by, 'va'))) end
    ),
    'paidDays', case when p.billing_status in ('active', 'trialing') then 2 else 0 end,
    'state', coalesce(x.state, 'off'), 'turnedOnAt', x.turned_on_at, 'pausedKey', x.paused_key, 'pausedAt', x.paused_at,
    'testCallAskedAt', x.test_call_asked_at,
    -- P941: the sign-up, read-only on the Setup ticket.
    'signup', jsonb_build_object(
      'tier', b.tier_key,
      'dailyCents', v_daily,
      'paidAt', coalesce(b.setup_paid_at, sc.updated_at),
      'paidCents', sc.amount_cents, 'setupCents', sc.setup_cents, 'planCents', sc.plan_cents,
      'leadCents', coalesce(sc.spend_cents, 0) + coalesce(sc.fee_cents, 0),
      'licensedAt', s.licensed_at,
      'tz', case when p.timezone_confirmed_at is not null then p.timezone end,
      'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'start', to_char(h.start_time, 'HH24:MI'),
                 'end', case when h.end_time = '24:00'::time then '24:00' else to_char(h.end_time, 'HH24:MI') end) order by h.weekday)
                 from agent_working_hours h where h.agent_id = p_agent), '[]'::jsonb),
      'live', p.live_transfer_phone is not null
    )
  );
end; $$;
revoke execute on function public.agent_launch_facts(uuid) from public, anon, authenticated;

-- ── 6. Seven plain checks, in the ticket's order ────────────────────────────
create or replace function public.agent_launch_checks(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := public.agent_launch_facts(p_agent);
  L jsonb;
  me text;
  n int;
  bad text[] := '{}';
begin
  if f is null then return null; end if;
  L := f->'launch';
  me := f->>'agentRef';
  n := jsonb_array_length(f->'states');
  if L->>'cardFailed' is not null or L->>'card' is null or coalesce((f->>'paidDays')::int, 0) < 2 then
    bad := array_append(bad, 'paid'); end if;
  if n < 3 or n > 10 or not coalesce((L->>'licence')::boolean, false) then
    bad := array_append(bad, 'states'); end if;
  if nullif(L->>'hours', '') is null or nullif(L->>'tz', '') is null then
    bad := array_append(bad, 'hours'); end if;
  if L->>'linkRef' is null or L->>'linkRef' <> me or L->>'campaignId' is null or L->>'campaignRef' is distinct from me then
    bad := array_append(bad, 'link'); end if;
  if L->'testLead' is null or jsonb_typeof(L->'testLead') = 'null' or L->'testLead'->>'matchedRef' is distinct from me then
    bad := array_append(bad, 'testLead'); end if;
  if L->'testLead' is null or jsonb_typeof(L->'testLead') = 'null' or L->'testCall' is null or jsonb_typeof(L->'testCall') = 'null' then
    bad := array_append(bad, 'testCall'); end if;
  if f->>'lead' = 'live' and not (coalesce((L->'app'->>'installed')::boolean, false) and coalesce((L->'app'->>'pushAnswered')::boolean, false)) then
    bad := array_append(bad, 'app'); end if;
  return jsonb_build_object('ok', cardinality(bad) = 0, 'failed', to_jsonb(bad), 'facts', f);
end; $$;
revoke execute on function public.agent_launch_checks(uuid) from public, anon, authenticated;
grant  execute on function public.agent_launch_checks(uuid) to service_role;

-- The words for a check (the paused alert names it the way the ticket does).
create or replace function public.launch_check_words(k text) returns text language sql immutable set search_path = public as $$
  select case k
    when 'paid' then 'Paid: setup + first 2 days'
    when 'states' then 'States picked'
    when 'hours' then 'Hours set'
    when 'link' then 'Ad link + campaign saved'
    when 'testLead' then 'Test lead arrived for this agent'
    when 'testCall' then 'Test call reached the agent'
    when 'app' then 'App installed + test push answered'
    when 'profile' then 'States picked'
    else k end
$$;

create or replace function public.launch_checks_sweep() returns int language plpgsql security definer set search_path = public as $$
declare
  x record;
  v jsonb;
  k text;
  n int := 0;
begin
  if not public.launch_gate_on() then return 0; end if;
  for x in select l.agent_id, p.full_name from agent_launch l join profiles p on p.id = l.agent_id where l.state = 'on' loop
    v := public.agent_launch_checks(x.agent_id);
    if v is null or (v->>'ok')::boolean then
      update agent_launch set checked_at = now() where agent_id = x.agent_id;
      continue;
    end if;
    k := v->'failed'->>0;
    update agent_launch set state = 'paused', paused_at = now(), paused_key = k, checked_at = now(), updated_at = now()
     where agent_id = x.agent_id;
    perform public.lead_spend_refresh_control(x.agent_id);
    perform public.notify(a.id, 'campaign_launch_paused', 'Campaign paused: ' || coalesce(x.full_name, 'an agent'),
              'This launch check broke: ' || public.launch_check_words(k) || '. Fix it on Setup, then turn the campaign on again.',
              '/admin/setup', true, 'launch-paused:' || x.agent_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
              jsonb_build_object('agent_id', x.agent_id, 'check', k))
      from profiles a where a.role::text = 'admin' and coalesce(a.is_active, true) and not coalesce(a.is_demo, false);
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke execute on function public.launch_checks_sweep() from public, anon, authenticated;

-- ── 7. The agent's own launch checks ────────────────────────────────────────
create or replace function public.my_launch_checks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role::text = 'agent') then
    raise exception 'Agents only' using errcode = '42501';
  end if;
  return public.agent_launch_checks(auth.uid());
end; $$;
revoke execute on function public.my_launch_checks() from public, anon;
grant  execute on function public.my_launch_checks() to authenticated;
