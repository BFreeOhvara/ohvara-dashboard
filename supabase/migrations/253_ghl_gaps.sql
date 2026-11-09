-- P915 — close the GoHighLevel gaps before Jordan connects (P904's hand-off gaps) plus P913's server half.
-- Builds on 230 (bridge), 232 (intake, campaign map, setup ticks), 234 (transfer readiness), 237/241/242/249/250
-- (agent_campaign_control and its guard), 248 (first call), 231 (VA days off), 251 (campaign match).
--
--   1. Agent codes: every agent gets a short code DS-XXXX (profiles.agent_code, fixed once given). agent_by_ref()
--      turns a full agent ID or a code (any case, "DS-" optional) into the agent. Used everywhere a lead comes in.
--   2. ghl_intake_lead: matches the code as well as the full ID; keeps Meta's test flag (lead_intake.is_test); an
--      unmatched lead now pushes every admin (notification lead_unmatched: bell, phone, email).
--   3. "Campaign created" from GoHighLevel: ghl_campaign_created(p) saves the campaign on the agent (ghl_save_campaign)
--      with the agent ref that rides in its ad link (ghl_campaign_agents.link_ref) and ticks Setup's campaign step.
--   4. Campaign on/off reaches GoHighLevel: agent_campaign_control rows that changed are claimed by ghl-push
--      (ghl_claim_controls), sent, and settled with ghl_control_result (retry with back-off, a log row per try,
--      admins told after 5 failed tries). Admin reads the last result on the row (push_*) and in ghl_control_log.
--   5. Launch checks on the server: agent_launch_facts / agent_launch_checks (the SQL twin of
--      src/adminshell/setup.js launchChecks), admin_launch_view for the Setup page, admin_turn_campaign_on (refuses
--      until every check passes), admin_place_test_call (asks the VAs to call the test lead: it rings the agent's own
--      phone), launch_checks_sweep every 15 minutes (a check that breaks pauses the campaign and tells admins).
--      The launch gate (only turned-on agents' campaigns run) applies while the bridge is on (ghl_settings.enabled);
--      with the bridge off nothing reaches GoHighLevel and the controls stay exactly as before.
--   6. VA days off: a monthly allowance (app_settings.va_days_off_per_month, default 2), enforced on every VA
--      insert; va_request_day_off books the day straight away (no approvals since P913) and tells admins (no action).
-- Nothing here turns a switch on. Show sample data stays on.

-- ── 1. Agent codes ──────────────────────────────────────────────────────────
alter table public.profiles add column if not exists agent_code text;
alter table public.profiles drop constraint if exists profiles_agent_code_check;
alter table public.profiles add constraint profiles_agent_code_check check (agent_code is null or agent_code ~ '^DS-[A-Z0-9]{3,6}$');
create unique index if not exists profiles_agent_code_key on public.profiles (agent_code) where agent_code is not null;
comment on column public.profiles.agent_code is
  'P915: the agent''s short code (DS-XXXX) that rides hidden in their ad link. Given once, never changed. agent_by_ref() matches it or the full ID.';

-- A free code from the first name (DS-OWEN, then DS-OWE2…), else four random hex characters.
create or replace function public.agent_code_make(p_name text, p_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  base text := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'));
  c text;
  i int;
begin
  if char_length(base) >= 3 then
    c := 'DS-' || left(base, 4);
    if not exists (select 1 from profiles where agent_code = c and id <> p_id) then return c; end if;
    for i in 2..99 loop
      c := 'DS-' || left(base, 3) || i;
      if not exists (select 1 from profiles where agent_code = c and id <> p_id) then return c; end if;
    end loop;
  end if;
  loop
    c := 'DS-' || upper(substr(md5(p_id::text || clock_timestamp()::text || random()::text), 1, 4));
    exit when not exists (select 1 from profiles where agent_code = c and id <> p_id);
  end loop;
  return c;
end; $$;
revoke execute on function public.agent_code_make(text, uuid) from public, anon, authenticated;

-- Agents get a code once they have a name; a code never changes after that (it's printed in their ad links).
create or replace function public.profiles_agent_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first text := split_part(btrim(coalesce(new.full_name, '')), ' ', 1);
begin
  if tg_op = 'UPDATE' and old.agent_code is not null and new.agent_code is distinct from old.agent_code then
    new.agent_code := old.agent_code;
  end if;
  if new.role::text = 'agent' and new.agent_code is null and char_length(regexp_replace(v_first, '[^A-Za-z]', '', 'g')) >= 3 then
    new.agent_code := public.agent_code_make(v_first, new.id);
  end if;
  return new;
end; $$;
revoke execute on function public.profiles_agent_code() from public, anon, authenticated;
drop trigger if exists profiles_agent_code on public.profiles;
create trigger profiles_agent_code before insert or update of role, full_name, agent_code on public.profiles
  for each row execute function public.profiles_agent_code();

-- Every agent today gets one (random when there's no usable name).
do $$
declare r record;
begin
  for r in select id, full_name from public.profiles where role::text = 'agent' and agent_code is null order by created_at, id loop
    update public.profiles set agent_code = public.agent_code_make(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), r.id)
     where id = r.id;
  end loop;
end $$;

-- The agent a ref points at: the full agent ID, or the code (any case, with or without "DS-"). Null when none.
create or replace function public.agent_by_ref(p_ref text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v text := upper(btrim(coalesce(p_ref, '')));
  v_id uuid;
begin
  if v = '' then return null; end if;
  if v ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
    select id into v_id from profiles where id = lower(v)::uuid and role::text = 'agent';
    return v_id;
  end if;
  if v !~ '^DS-' then v := 'DS-' || v; end if;
  select id into v_id from profiles where agent_code = v and role::text = 'agent';
  return v_id;
end; $$;
revoke execute on function public.agent_by_ref(text) from public, anon, authenticated;
grant  execute on function public.agent_by_ref(text) to service_role;

-- ── 2. Notification types for admins ───────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, array['admin'], v.label, v.email, case when v.email then 'notify' end, true, true, false, true,
       coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values
    ('lead_unmatched',          'A lead couldn''t be matched to an agent',     true,  1),
    ('campaign_launch_paused',  'A campaign paused: a launch check broke',     true,  2),
    ('ghl_control_failing',     'Campaign on/off isn''t reaching GoHighLevel', true,  3),
    ('va_test_call',            'Test call to place',                          false, 4)
  ) as v(type, label, email, n)
on conflict (type) do nothing;
update public.notification_types set roles = array['fulfillment'] where type = 'va_test_call';

-- ── 3. Intake: the code matches, the test flag, the unmatched push ─────────
alter table public.lead_intake add column if not exists is_test boolean not null default false;
comment on column public.lead_intake.is_test is 'P915: the engine marked it a test lead (Meta''s lead testing tool). The launch check''s test lead.';

create or replace function public.ghl_intake_lead(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_key    text := nullif(btrim(p->>'intake_key'), '');
  v_kind   text := coalesce(nullif(p->>'lead_type', ''), 'booked_appointment');
  v_phone  text := public.sms_e164(p->>'phone');
  v_state  text := upper(nullif(btrim(p->>'state'), ''));
  v_first  text := left(nullif(btrim(p->>'first_name'), ''), 80);
  v_last   text := left(nullif(btrim(p->>'last_name'), ''), 80);
  v_name   text;
  v_ref    text := left(nullif(btrim(p->>'agent_id'), ''), 80);
  v_camp   text := left(nullif(btrim(p->>'campaign_id'), ''), 80);
  v_test   boolean := lower(coalesce(p->>'is_test', '')) in ('true', 't', '1', 'yes');
  v_by     uuid;
  v_agent  uuid;
  v_route  text;
  v_lead   uuid;
  v_seen   record;
  v_ok     boolean;
begin
  if v_key is null or char_length(v_key) < 6 then raise exception 'intake_key is required' using errcode = '22004'; end if;
  if v_kind not in ('booked_appointment', 'live_call') then raise exception 'bad lead_type' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'bad phone' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(concat_ws(' ', v_first, v_last)), ''), 'Lead');

  perform pg_advisory_xact_lock(hashtextextended('ghl_intake:' || v_phone, 0));

  -- 1. The same delivery again (an engine retry): nothing new.
  select lead_id, routing into v_seen from lead_intake where intake_key = v_key;
  if found then
    return jsonb_build_object('lead_id', v_seen.lead_id, 'routing', v_seen.routing, 'duplicate', true);
  end if;

  -- 2. Same phone on a typed lead in the last 30 days: logged against the first lead, no second lead.
  select id into v_lead from leads
   where phone = v_phone and lead_type in ('mortgage_protection', 'policy_help')
     and created_at >= now() - interval '30 days'
   order by created_at limit 1;
  if v_lead is not null then
    insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url, is_test)
    values (v_key, v_lead, v_ref, 'duplicate', v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
            left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500), v_test);
    return jsonb_build_object('lead_id', v_lead, 'routing', 'duplicate', 'duplicate', true);
  end if;

  -- 3. Who it goes to: the agent ref in the ad link (full ID or DS-XXXX code, P915), else the Meta campaign ID (one
  --    campaign per agent, saved when GoHighLevel creates it). Only both missing or matching no agent is 'missing' /
  --    'unknown' (the admin alert, now pushed to every admin).
  v_by := public.agent_by_ref(v_ref);
  if v_by is not null then
    v_route := 'matched';
  elsif v_camp is not null then
    select g.agent_id into v_by from ghl_campaign_agents g
     where (g.campaign_id = v_camp or g.fb_campaign_id = v_camp) and g.agent_id is not null
     order by (g.campaign_id = v_camp) desc limit 1;
    if v_by is not null then v_route := 'campaign'; end if;
  end if;

  if v_by is null then
    v_route := case when v_ref is null and v_camp is null then 'missing' else 'unknown' end;
  elsif not exists (select 1 from profiles where id = v_by and role = 'agent' and is_active) then
    v_route := 'inactive';
  else
    v_agent := v_by;
    -- Same test as assign_lead: one of the agent's states, and (once P881 is on) a verified licence there.
    v_ok := v_state is not null
            and exists (select 1 from agent_lead_settings s where s.agent_id = v_agent and v_state = any (s.states));
    if v_ok and to_regprocedure('public.licence_allows(uuid,text)') is not null then
      execute 'select public.licence_allows($1, $2)' into v_ok using v_agent, v_state;
    end if;
    if not coalesce(v_ok, false) then v_route := 'unlicensed'; v_agent := null; end if;
  end if;

  insert into leads (lead_type, lead_source, business_name, contact_name, phone, email, state, qualifier_answers, is_sample)
  values (
    case v_kind when 'live_call' then 'policy_help' else 'mortgage_protection' end, 'meta', v_name, v_name, v_phone,
    left(nullif(btrim(p->>'email'), ''), 200), v_state,
    jsonb_strip_nulls(jsonb_build_object(
      'consent_at', p->>'consent_at', 'consent_text_version', p->>'consent_text_version',
      'postal_code', left(p->>'postal_code', 10), 'source', 'ghl', 'is_test', case when v_test then true end
    )) || coalesce(case when jsonb_typeof(p->'answers') = 'object' then p->'answers' end, '{}'::jsonb),
    false)
  returning id into v_lead;

  if v_agent is not null then
    update leads set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
     where id = v_lead and assigned_rep_id is null;
  end if;

  insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url, is_test)
  values (v_key, v_lead, v_ref, v_route, v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
          left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500), v_test);

  -- P915: a lead that matched no agent pushes every admin (Overview's alert has the Assign).
  if v_route in ('missing', 'unknown') then
    perform public.notify(a.id, 'lead_unmatched', 'A lead couldn''t be matched to an agent',
              case v_route when 'missing' then 'No agent ID in the ad link and no Meta campaign ID. Pick one.'
                           else 'The agent ID and the campaign ID match no agent. Pick one.' end,
              '/admin', true, 'unmatched:' || v_lead, jsonb_build_object('lead_id', v_lead, 'why', v_route))
      from profiles a
     where a.role::text = 'admin' and coalesce(a.is_active, true) and not coalesce(a.is_demo, false);
  end if;

  return jsonb_build_object('lead_id', v_lead, 'routing', v_route, 'agent_id', v_agent, 'duplicate', false);
end;
$$;
revoke execute on function public.ghl_intake_lead(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_intake_lead(jsonb) to service_role;

-- ── 4. "Campaign created" from GoHighLevel ──────────────────────────────────
alter table public.ghl_campaign_agents add column if not exists link_ref text check (char_length(link_ref) <= 80);
comment on column public.ghl_campaign_agents.link_ref is 'P915: the agent ref GoHighLevel put in this campaign''s ad link (DS-XXXX or the full ID). Launch check "link".';

-- p: { agent_id (code or full ID, as in the ad link), campaign_id (GoHighLevel's), fb_campaign_id (Meta's),
--      campaign_name, lead_type: appts | live (booked_appointment / live_call also read) }.
create or replace function public.ghl_campaign_created(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref   text := left(nullif(btrim(coalesce(p->>'agent_id', p->>'agent_ref')), ''), 80);
  v_camp  text := left(nullif(btrim(p->>'campaign_id'), ''), 80);
  v_fb    text := left(nullif(btrim(coalesce(p->>'fb_campaign_id', p->>'meta_campaign_id')), ''), 80);
  v_word  text := lower(coalesce(nullif(btrim(p->>'lead_type'), ''), 'appts'));
  v_type  text;
  v_agent uuid;
begin
  v_type := case when v_word in ('live', 'live_call', 'call', 'calls') then 'live'
                 when v_word in ('appts', 'appt', 'appointment', 'booked_appointment', 'form') then 'appts' end;
  if v_type is null then raise exception 'bad lead type' using errcode = '22023'; end if;
  if v_camp is null and v_fb is null then raise exception 'campaign_id is required' using errcode = '22004'; end if;
  v_agent := public.agent_by_ref(v_ref);
  if v_agent is null then raise exception 'unknown agent' using errcode = '22023'; end if;
  v_camp := coalesce(v_camp, v_fb);
  perform public.ghl_save_campaign(v_camp, v_agent, v_fb, nullif(btrim(p->>'campaign_name'), ''), v_type);
  update ghl_campaign_agents set link_ref = v_ref, status = coalesce(status, 'created') where campaign_id = v_camp;
  insert into agent_setup_ticks (agent_id, step) values (v_agent, 'campaign'), (v_agent, 'mapped')
  on conflict (agent_id, step) do nothing;
  return jsonb_build_object('agent_id', v_agent, 'campaign_id', v_camp, 'lead_type', v_type);
end; $$;
revoke execute on function public.ghl_campaign_created(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_campaign_created(jsonb) to service_role;

-- GoHighLevel confirms what it did with a control row, by agent ref (the webhook's campaign_state event).
create or replace function public.ghl_campaign_state(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := public.agent_by_ref(p->>'agent_id');
  v_word  text := lower(coalesce(nullif(btrim(p->>'lead_type'), ''), 'appts'));
  v_type  text := case when v_word in ('live', 'live_call', 'call', 'calls') then 'live' else 'appts' end;
  v_state text := left(nullif(btrim(p->>'state'), ''), 60);
begin
  if v_agent is null then raise exception 'unknown agent' using errcode = '22023'; end if;
  if v_state is null then raise exception 'state is required' using errcode = '22004'; end if;
  perform public.campaign_control_confirm(v_agent, v_type, v_state, null);
  return jsonb_build_object('agent_id', v_agent, 'lead_type', v_type, 'state', v_state);
end; $$;
revoke execute on function public.ghl_campaign_state(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_campaign_state(jsonb) to service_role;

-- ── 5. The launch state and the launch gate ─────────────────────────────────
create table if not exists public.agent_launch (
  agent_id            uuid primary key references public.profiles(id) on delete cascade,
  state               text not null default 'off' check (state in ('off', 'on', 'paused')),
  turned_on_at        timestamptz,
  turned_on_by        uuid references public.profiles(id) on delete set null,
  paused_at           timestamptz,
  paused_key          text check (paused_key in ('link', 'testLead', 'profile', 'paid', 'app', 'testCall')),
  test_call_asked_at  timestamptz,
  test_call_asked_by  uuid references public.profiles(id) on delete set null,
  checked_at          timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.agent_launch enable row level security;
revoke all on public.agent_launch from public, anon, authenticated;
grant select on public.agent_launch to authenticated;
drop policy if exists agent_launch_admin_read on public.agent_launch;
create policy agent_launch_admin_read on public.agent_launch for select to authenticated using (public.is_admin());
comment on table public.agent_launch is
  'P915: Turn campaign on (admin_turn_campaign_on, only once every launch check passes). A check that breaks later pauses it (launch_checks_sweep). Admins only.';

-- Agents already live count as turned on.
insert into public.agent_launch (agent_id, state, turned_on_at)
select t.agent_id, 'on', t.done_at from public.agent_setup_ticks t
  join public.profiles p on p.id = t.agent_id and p.role::text = 'agent'
 where t.step = 'live'
on conflict (agent_id) do nothing;

-- The gate applies while the bridge is on; with it off nothing reaches GoHighLevel anyway.
create or replace function public.launch_gate_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from ghl_settings where id), false)
$$;
revoke execute on function public.launch_gate_on() from public, anon, authenticated;

-- ── 6. Campaign on/off → GoHighLevel ────────────────────────────────────────
alter table public.agent_campaign_control
  add column if not exists push_attempts int not null default 0,
  add column if not exists push_next_at  timestamptz,
  add column if not exists push_tried_at timestamptz,
  add column if not exists push_status   int,
  add column if not exists push_error    text check (char_length(push_error) <= 300);
comment on column public.agent_campaign_control.push_error is
  'P915: the last failed send to GoHighLevel (null after a good one). push_attempts counts failures since the last change; push_next_at = the retry.';

create table if not exists public.ghl_control_log (
  id          bigint generated always as identity primary key,
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  lead_type   text not null check (lead_type in ('appts', 'live')),
  at          timestamptz not null default now(),
  ok          boolean not null,
  http_status int,
  error       text check (char_length(error) <= 300),
  attempt     int not null default 1,
  sent        jsonb
);
create index if not exists ghl_control_log_agent_idx on public.ghl_control_log (agent_id, at desc);
alter table public.ghl_control_log enable row level security;
revoke all on public.ghl_control_log from public, anon, authenticated;
grant select on public.ghl_control_log to authenticated;
drop policy if exists ghl_control_log_admin_read on public.ghl_control_log;
create policy ghl_control_log_admin_read on public.ghl_control_log for select to authenticated using (public.is_admin());
comment on table public.ghl_control_log is 'P915: every send of a campaign on/off row to GoHighLevel (ghl-push), good or failed. Admins only.';

-- The guard every control write passes (242's pause guard + P915): a paused agent stops; with the bridge on, an agent
-- not turned on (or paused by a broken launch check) stops; a changed row starts its retries over.
create or replace function public.campaign_control_pause_guard() returns trigger language plpgsql
security definer set search_path = public as $$
declare x agent_launch;
begin
  if exists (select 1 from agent_lead_pause z where z.agent_id = new.agent_id and z.active) then
    new.run := false; new.daily_budget_cents := 0; new.cap_cents := 0; new.reason := 'paused by agent';
  elsif public.launch_gate_on() then
    select * into x from agent_launch where agent_id = new.agent_id;
    if x.state is distinct from 'on' then
      new.run := false; new.daily_budget_cents := 0; new.cap_cents := 0;
      new.reason := case when x.state = 'paused' then 'launch check: ' || coalesce(x.paused_key, 'broken') else 'not launched' end;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.changed_at is distinct from old.changed_at then
    new.push_attempts := 0; new.push_next_at := null;
  end if;
  return new;
end; $$;

-- ghl-push takes the rows waiting to be sent (pushed_at empty or older than changed_at), oldest change first, and
-- holds them for 2 minutes so a second run doesn't send them twice.
create or replace function public.ghl_claim_controls(p_limit int default 25)
returns table (agent_id uuid, lead_type text, run boolean, daily_budget_cents int, cap_cents int, reason text,
               split_form_pct int, schedule jsonb, changed_at timestamptz, attempt int, agent_code text, agent_name text,
               campaign_id text, fb_campaign_id text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select c.agent_id, c.lead_type from agent_campaign_control c
     where (c.pushed_at is null or c.pushed_at < c.changed_at)
       and (c.push_next_at is null or c.push_next_at <= now())
     order by c.changed_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), held as (
    update agent_campaign_control c set push_next_at = now() + interval '2 minutes'
      from due where c.agent_id = due.agent_id and c.lead_type = due.lead_type
    returning c.*
  )
  select h.agent_id, h.lead_type, h.run, h.daily_budget_cents, h.cap_cents, h.reason, h.split_form_pct, h.schedule,
         h.changed_at, h.push_attempts + 1, p.agent_code, p.full_name, g.campaign_id, g.fb_campaign_id
    from held h
    join profiles p on p.id = h.agent_id
    left join lateral (select g0.campaign_id, g0.fb_campaign_id from ghl_campaign_agents g0
                        where g0.agent_id = h.agent_id and coalesce(g0.lead_type, 'appts') = h.lead_type
                        order by g0.mapped_at desc nulls last limit 1) g on true;
end; $$;
revoke execute on function public.ghl_claim_controls(int) from public, anon, authenticated;
grant  execute on function public.ghl_claim_controls(int) to service_role;

-- How a send went. Good: the row is pushed (unless it changed again meanwhile). Failed: retry after 1, 2, 4… minutes
-- (at most an hour); after the 5th failure in a row every admin hears once.
create or replace function public.ghl_control_result(p_agent uuid, p_type text, p_changed_at timestamptz, p_ok boolean,
                                                      p_status int default null, p_error text default null, p_sent jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c agent_campaign_control;
  v_name text;
begin
  select * into c from agent_campaign_control where agent_id = p_agent and lead_type = p_type for update;
  if not found then return; end if;
  insert into ghl_control_log (agent_id, lead_type, ok, http_status, error, attempt, sent)
  values (p_agent, p_type, p_ok, p_status, left(p_error, 300), c.push_attempts + 1, p_sent);
  if p_ok then
    update agent_campaign_control
       set pushed_at = case when changed_at <= p_changed_at then now() else p_changed_at end,
           push_attempts = 0, push_next_at = null, push_tried_at = now(), push_status = p_status, push_error = null
     where agent_id = p_agent and lead_type = p_type;
  else
    update agent_campaign_control
       set push_attempts = c.push_attempts + 1,
           push_next_at = now() + make_interval(mins => least(60, (2 ^ least(c.push_attempts, 6))::int)),
           push_tried_at = now(), push_status = p_status, push_error = left(coalesce(p_error, 'failed'), 300)
     where agent_id = p_agent and lead_type = p_type;
    if c.push_attempts + 1 = 5 then
      select full_name into v_name from profiles where id = p_agent;
      perform public.notify(a.id, 'ghl_control_failing', 'Campaign on/off isn''t reaching GoHighLevel',
                coalesce(v_name, 'An agent') || ' · ' || case p_type when 'live' then 'call ads' else 'form ads' end
                  || ': ' || left(coalesce(p_error, 'failed'), 120) || '. Still retrying.',
                '/admin/setup', true, 'ghl-control:' || p_agent || ':' || p_type || ':' || extract(epoch from c.changed_at)::bigint,
                jsonb_build_object('agent_id', p_agent, 'lead_type', p_type))
        from profiles a
       where a.role::text = 'admin' and coalesce(a.is_active, true) and not coalesce(a.is_demo, false);
    end if;
  end if;
end; $$;
revoke execute on function public.ghl_control_result(uuid, text, timestamptz, boolean, int, text, jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_control_result(uuid, text, timestamptz, boolean, int, text, jsonb) to service_role;

-- ── 7. The launch checks on the server (twin of src/adminshell/setup.js launchChecks) ──
-- The facts, in the shape the Setup page's launchChecks(c) reads: { agentRef, lead, states, launch: { linkRef,
-- campaignId, campaignRef, testLead: { at, matchedRef, by, leadId }, licence, hours, tz, card, cardFailed,
-- app: { installed, pushAnswered }, testCall: { at, by } }, state, turnedOnAt, pausedKey, testCallAskedAt }.
create or replace function public.agent_launch_facts(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p    profiles;
  v_me text;
  v_states text[];
  g    record;
  tl   record;
  r    transfer_readiness;
  x    agent_launch;
  v_dev int;
  v_link text;
begin
  select * into p from profiles where id = p_agent and role::text = 'agent';
  if not found then return null; end if;
  v_me := coalesce(p.agent_code, p.id::text);
  select s.states into v_states from agent_lead_settings s where s.agent_id = p_agent;
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
  return jsonb_build_object(
    'agentRef', v_me,
    'lead', case when p.live_transfer_phone is not null then 'live' else 'appointment' end,
    'states', to_jsonb(coalesce(v_states, '{}'::text[])),
    'launch', jsonb_build_object(
      'linkRef', v_link,
      'campaignId', coalesce(g.fb_campaign_id, g.campaign_id),
      'campaignRef', case when g.campaign_id is not null then v_me end,
      'testLead', case when tl.lead_id is not null then jsonb_build_object('at', tl.received_at, 'matchedRef', v_me,
                    'by', case tl.routing when 'campaign' then 'campaign' else 'link' end, 'leadId', tl.lead_id) end,
      'licence', p.npn is not null and btrim(p.npn) <> '',
      'hours', p.working_hours_start, 'tz', p.timezone,
      'card', case when p.billing_status in ('active', 'trialing') then 'Card on file' end,
      'cardFailed', case when p.billing_status = 'past_due' then 'past due' end,
      'app', jsonb_build_object('installed', v_dev > 0, 'pushAnswered', r.push_ok_at is not null),
      'testCall', case when tl.first_call_at is not null then jsonb_build_object('at', tl.first_call_at, 'by', upper(coalesce(tl.first_call_by, 'va'))) end
    ),
    'paidDays', case when p.billing_status in ('active', 'trialing') then 2 else 0 end,
    'state', coalesce(x.state, 'off'), 'turnedOnAt', x.turned_on_at, 'pausedKey', x.paused_key, 'pausedAt', x.paused_at,
    'testCallAskedAt', x.test_call_asked_at
  );
end; $$;
revoke execute on function public.agent_launch_facts(uuid) from public, anon, authenticated;

-- Which checks fail, in the Setup page's order. { ok, failed: [keys], facts }.
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
  if L->>'linkRef' is null or L->>'linkRef' <> me or L->>'campaignId' is null or L->>'campaignRef' is distinct from me then
    bad := array_append(bad, 'link'); end if;
  if L->'testLead' is null or jsonb_typeof(L->'testLead') = 'null' or L->'testLead'->>'matchedRef' is distinct from me then
    bad := array_append(bad, 'testLead'); end if;
  if n < 3 or n > 10 or not coalesce((L->>'licence')::boolean, false) or nullif(L->>'hours', '') is null or nullif(L->>'tz', '') is null then
    bad := array_append(bad, 'profile'); end if;
  if L->>'cardFailed' is not null or L->>'card' is null or coalesce((f->>'paidDays')::int, 0) < 2 then
    bad := array_append(bad, 'paid'); end if;
  if f->>'lead' = 'live' and not (coalesce((L->'app'->>'installed')::boolean, false) and coalesce((L->'app'->>'pushAnswered')::boolean, false)) then
    bad := array_append(bad, 'app'); end if;
  if L->'testLead' is null or jsonb_typeof(L->'testLead') = 'null' or L->'testCall' is null or jsonb_typeof(L->'testCall') = 'null' then
    bad := array_append(bad, 'testCall'); end if;
  return jsonb_build_object('ok', cardinality(bad) = 0, 'failed', to_jsonb(bad), 'facts', f);
end; $$;
revoke execute on function public.agent_launch_checks(uuid) from public, anon, authenticated;
grant  execute on function public.agent_launch_checks(uuid) to service_role;

-- Admin Setup: every agent's facts and checks, plus the last send of each control row.
create or replace function public.admin_launch_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('agent_id', p.id, 'checks', public.agent_launch_checks(p.id),
             'push', (select jsonb_agg(jsonb_build_object('lead_type', c.lead_type, 'run', c.run, 'reason', c.reason,
                        'daily_budget_cents', c.daily_budget_cents, 'changed_at', c.changed_at, 'pushed_at', c.pushed_at,
                        'tried_at', c.push_tried_at, 'attempts', c.push_attempts, 'error', c.push_error, 'next_at', c.push_next_at,
                        'engine_state', c.engine_state) order by c.lead_type)
                        from agent_campaign_control c where c.agent_id = p.id)))
      from profiles p where p.role::text = 'agent' and coalesce(p.is_active, true) and p.deleted_at is null), '[]'::jsonb);
end; $$;
revoke execute on function public.admin_launch_view() from public, anon;
grant  execute on function public.admin_launch_view() to authenticated;

-- Setup's "States and spend checked" tick (P913's step) has a home on real data too.
alter table public.agent_setup_ticks drop constraint if exists agent_setup_ticks_step_check;
alter table public.agent_setup_ticks add constraint agent_setup_ticks_step_check
  check (step in ('states', 'campaign', 'budget', 'mapped', 'link', 'tracking', 'workflows', 'briefed', 'test', 'live'));

-- Turn campaign on: only when every launch check passes (no skipping). Audit-logged. ("Mark done" stays admin_mark_live.)
create or replace function public.admin_turn_campaign_on(p_agent uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  v := public.agent_launch_checks(p_agent);
  if v is null then raise exception 'Not an agent' using errcode = '22023'; end if;
  if not (v->>'ok')::boolean then
    raise exception 'Every launch check must pass first (failing: %)', (select string_agg(k, ', ') from jsonb_array_elements_text(v->'failed') k)
      using errcode = 'P0001';
  end if;
  insert into agent_launch (agent_id, state, turned_on_at, turned_on_by, paused_at, paused_key, checked_at, updated_at)
  values (p_agent, 'on', now(), auth.uid(), null, null, now(), now())
  on conflict (agent_id) do update set state = 'on', turned_on_at = now(), turned_on_by = auth.uid(),
    paused_at = null, paused_key = null, checked_at = now(), updated_at = now();
  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, new_values)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), 'admin_turn_campaign_on', 'campaign_on',
          'agent_launch', p_agent::text, jsonb_build_object('checks', v->'failed'));
  perform public.lead_spend_refresh_control(p_agent);
  return v;
end; $$;
revoke execute on function public.admin_turn_campaign_on(uuid) from public, anon;
grant  execute on function public.admin_turn_campaign_on(uuid) to authenticated;

-- Place test call: the first call on the agent's test lead (it carries their own number) rings their phone. Until an
-- AI caller is chosen the VAs place it: every active VA is told now.
create or replace function public.admin_place_test_call(p_agent uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f jsonb;
  v_lead uuid;
  v_name text;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  f := public.agent_launch_facts(p_agent);
  if f is null then raise exception 'Not an agent' using errcode = '22023'; end if;
  if f->'launch'->'testLead' is null or jsonb_typeof(f->'launch'->'testLead') = 'null' then
    raise exception 'Waits for the test lead' using errcode = 'P0001';
  end if;
  if jsonb_typeof(f->'launch'->'testCall') = 'object' then
    return jsonb_build_object('already', true, 'at', f->'launch'->'testCall'->>'at');
  end if;
  v_lead := (f->'launch'->'testLead'->>'leadId')::uuid;
  select full_name into v_name from profiles where id = p_agent;
  with sent as (
    select public.notify(va.id, 'va_test_call', 'Test call: ' || coalesce(v_name, 'an agent') || '''s test lead',
             'Call it now: it rings ' || coalesce(split_part(v_name, ' ', 1), 'the agent') || '''s own phone. Log it like any first call.',
             '/fulfillment', true, 'test-call:' || v_lead || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
             jsonb_build_object('lead_id', v_lead, 'agent_id', p_agent)) as nid
      from profiles va where va.role::text = 'fulfillment' and coalesce(va.is_active, true) and not coalesce(va.is_demo, false)
  ) select count(nid)::int into n from sent;
  insert into agent_launch (agent_id, test_call_asked_at, test_call_asked_by) values (p_agent, now(), auth.uid())
  on conflict (agent_id) do update set test_call_asked_at = now(), test_call_asked_by = auth.uid(), updated_at = now();
  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, new_values)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), 'admin_place_test_call', 'test_call_asked',
          'agent_launch', p_agent::text, jsonb_build_object('lead_id', v_lead, 'vas', n));
  return jsonb_build_object('asked', n, 'lead_id', v_lead);
end; $$;
revoke execute on function public.admin_place_test_call(uuid) from public, anon;
grant  execute on function public.admin_place_test_call(uuid) to authenticated;

-- Every 15 minutes, while the bridge is on: a turned-on campaign whose check broke pauses, its ticket reopens on that
-- tick (Setup), and admins hear. Turning it on again needs every check passing again.
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
              'A launch check broke (' || k || '). Fix it on Setup, then turn the campaign on again.',
              '/admin/setup', true, 'launch-paused:' || x.agent_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
              jsonb_build_object('agent_id', x.agent_id, 'check', k))
      from profiles a where a.role::text = 'admin' and coalesce(a.is_active, true) and not coalesce(a.is_demo, false);
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke execute on function public.launch_checks_sweep() from public, anon, authenticated;

-- Turning the bridge on or off re-checks every agent's controls through the gate.
create or replace function public.ghl_settings_gate_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  if new.enabled is distinct from old.enabled then
    for a in select distinct c.agent_id from agent_campaign_control c loop perform public.lead_spend_refresh_control(a); end loop;
  end if;
  return null;
end; $$;
revoke execute on function public.ghl_settings_gate_changed() from public, anon, authenticated;
drop trigger if exists ghl_settings_gate_changed on public.ghl_settings;
create trigger ghl_settings_gate_changed after update of enabled on public.ghl_settings
  for each row execute function public.ghl_settings_gate_changed();

-- ── 8. VA days off: a monthly allowance, no approvals ───────────────────────
alter table public.app_settings add column if not exists va_days_off_per_month int not null default 2
  check (va_days_off_per_month between 0 and 31);
comment on column public.app_settings.va_days_off_per_month is
  'P913/P915: days off a month each VA books for themselves (admin Fulfillment › Time off). Enforced on every VA booking.';

create or replace function public.day_off_allowance() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select va_days_off_per_month from app_settings where id = 1), 2)
$$;
grant execute on function public.day_off_allowance() to authenticated;

create or replace function public.va_day_off_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allow int;
  v_used int;
begin
  if not exists (select 1 from profiles where id = new.va_id and role = 'fulfillment') then
    raise exception 'Day-off requests are for VAs (Fulfillment logins) only' using errcode = '22023';
  end if;
  if public.is_admin() or auth.uid() is null then   -- admins, and the table owner (migrations, tests, service role)
    if new.status <> 'pending' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    elsif new.status = 'pending' then
      new.decided_by := null;
      new.decided_at := null;
    end if;
  else
    if new.off_date < public.va_today() then
      raise exception 'That day has already gone' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' then
      -- P915: the monthly allowance holds however the VA books (the RPC or a direct insert).
      v_allow := public.day_off_allowance();
      select count(*)::int into v_used from va_day_off_requests r
       where r.va_id = new.va_id and r.status <> 'declined'
         and date_trunc('month', r.off_date) = date_trunc('month', new.off_date) and r.off_date <> new.off_date;
      if v_used >= v_allow then
        raise exception 'You''ve used all % of your days off this month.', v_allow using errcode = 'P0001';
      end if;
      -- Booked by the VA themselves (va_request_day_off): no approval since P913.
      new.status := case when current_setting('ohvara.day_off_book', true) = 'on' then 'approved' else 'pending' end;
    else
      new.va_id := old.va_id;
      new.status := old.status;
    end if;
    new.decided_by := case when tg_op = 'INSERT' then null else old.decided_by end;
    new.decided_at := case when tg_op = 'INSERT' then null else old.decided_at end;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- A VA books a day off inside their monthly allowance: booked at once, admins told (nothing to approve).
create or replace function public.va_request_day_off(p_day date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
  v_status text;
  v_name text;
begin
  if not exists (select 1 from profiles where id = v_me and role = 'fulfillment' and is_active) then
    raise exception 'Only VAs can ask for a day off' using errcode = '42501';
  end if;
  if p_day is null or p_day < public.va_today() then
    raise exception 'Pick a day that is still ahead' using errcode = '22023';
  end if;
  if p_day > public.va_today() + 120 then
    raise exception 'Ask no more than four months ahead' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023';
  end if;

  select id, status into v_id, v_status from va_day_off_requests
   where va_id = v_me and off_date = p_day for update;

  if v_id is not null and v_status = 'approved' then
    return v_id;
  elsif v_id is not null and v_status = 'pending' then
    update va_day_off_requests set reason = v_reason where id = v_id;
    return v_id;
  end if;
  if v_id is not null then
    delete from va_day_off_requests where id = v_id;   -- declined before P913: book it fresh
  end if;
  perform set_config('ohvara.day_off_book', 'on', true);
  insert into va_day_off_requests (va_id, off_date, reason) values (v_me, p_day, v_reason)
  returning id into v_id;
  perform set_config('ohvara.day_off_book', 'off', true);

  select full_name into v_name from profiles where id = v_me;
  perform public.notify(a.id, 'va_day_off_requested',
            coalesce(nullif(btrim(v_name), ''), 'A VA') || ' booked a day off',
            to_char(p_day, 'Dy, Mon FMDD') || coalesce(' · ' || v_reason, ''),
            '/admin/fulfillment', false, 'dayoff-ask:' || v_id,
            jsonb_build_object('request_id', v_id, 'va_id', v_me, 'day', p_day))
    from profiles a
   where a.role = 'admin' and a.is_active and a.is_demo = public.my_is_demo();
  return v_id;
end;
$$;

-- ── 9. Cron: the launch sweep every 15 minutes (does nothing while the bridge is off) ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'launch-checks-sweep';
    perform cron.schedule('launch-checks-sweep', '7,22,37,52 * * * *', 'select public.launch_checks_sweep()');
  end if;
end $$;
