-- 232 — Admin side build-out: lead routing by agent ID and ad spend from
-- GoHighLevel's Ad Manager (Prompt 858). WRITTEN, NOT APPLIED: applying goes
-- through Brayden's door (brain/ohvara/admin-backend-map.md in the vault).
-- Applying it starts nothing: every switch here defaults OFF and no cron is made.
--
-- What it adds:
--   lead_intake           one row per lead the engine posts (ghl-webhook
--                         `lead_created`): the hidden agent ID from the ad link,
--                         how it routed (matched / unknown / missing / inactive /
--                         unlicensed / duplicate / assigned), the Meta option
--                         (form_page = form then landing page, page_only) and
--                         the ad IDs, for admin reports. Admins only: agents
--                         see the lead and its type on leads, never this.
--   ghl_intake_lead(jsonb)  service role only. Saves the lead exactly once per
--                         intake key, drops a repeat phone inside 30 days onto
--                         the first lead, and assigns it to the agent in the
--                         ad link when that agent is an active agent licensed
--                         for the lead's state. Anything else lands unassigned
--                         (admin Leads → Unassigned). It never falls back to
--                         assign_lead's round robin (Brayden, Nov 5: unknown
--                         or missing ID goes to admin).
--   admin_assign_lead(lead, agent)   admin "Assign to…", audit-logged.
--   admin_unassigned_leads()         the Unassigned lane.
--   ghl_campaign_agents   campaign → agent map (one Meta campaign per agent),
--                         with the lead type the campaign buys. Admins read it
--                         and map through admin_map_campaign; audit-logged.
--   ad_spend_daily        spend, impressions, clicks, leads per campaign per
--                         day, as GHL's Ad Manager reports them. Admins only.
--   ghl_ad_spend_save(jsonb, text, text)  service role only (ghl-ad-spend).
--   admin_ad_costs(from, to)  per agent: spend, leads, booked, sold and the
--                         cost per lead / booked / sale from real outcomes.
--   ghl_settings          + ad_spend_enabled (the function's switch, OFF),
--                         + ad_spend_bills_agents (feeding delivered spend into
--                         the P884 lead-spend ledger, which charges balances:
--                         OFF, Brayden's call), + last ad sync status.
--   app_settings          + show_sample_data (P848's company switch, default
--                         ON; "if not exists" so it is harmless if another
--                         migration adds it first).
--
-- Cron (Brayden's door, after ghl-ad-spend is deployed; not in this file):
--   select cron.schedule('ghl-ad-spend', '30 6 * * *',
--     $$select public.fulfillment_cron_post('ghl-ad-spend', '{"action":"run"}'::jsonb)$$);

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '232 needs 152_admin_role_paths applied first';
  end if;
  if to_regclass('public.admin_audit_log') is null or to_regprocedure('public.audit_row()') is null then
    raise exception '232 needs 153_admin_audit_log applied first';
  end if;
  if to_regprocedure('public.sms_e164(text)') is null then
    raise exception '232 needs 157_text_consent applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'inbound_stage') then
    raise exception '232 needs 180_agent_inbounds applied first';
  end if;
  if to_regclass('public.ghl_settings') is null then
    raise exception '232 needs 230_ghl_integration applied first';
  end if;
end $$;

-- ── switches ────────────────────────────────────────────────────────────────
alter table public.ghl_settings
  add column if not exists ad_spend_enabled      boolean not null default false,
  add column if not exists ad_spend_bills_agents boolean not null default false,
  add column if not exists ad_spend_last_at      timestamptz,
  add column if not exists ad_spend_last_status  text check (ad_spend_last_status in ('ok', 'error', 'off', 'not_configured')),
  add column if not exists ad_spend_last_error   text check (char_length(ad_spend_last_error) <= 500);
grant update (ad_spend_enabled, ad_spend_bills_agents) on public.ghl_settings to authenticated;

alter table public.app_settings
  add column if not exists show_sample_data boolean not null default true;

-- ── lead intake ─────────────────────────────────────────────────────────────
create table if not exists public.lead_intake (
  id           bigint generated always as identity primary key,
  intake_key   text not null unique check (char_length(intake_key) between 6 and 120),
  lead_id      uuid references public.leads(id) on delete set null,
  received_at  timestamptz not null default now(),
  agent_ref    text check (char_length(agent_ref) <= 80),
  routing      text not null check (routing in ('matched', 'unknown', 'missing', 'inactive', 'unlicensed', 'duplicate', 'assigned')),
  lead_kind    text not null check (lead_kind in ('booked_appointment', 'live_call')),
  meta_option  text check (meta_option in ('form_page', 'page_only')),
  campaign_id  text check (char_length(campaign_id) <= 80),
  adset_id     text check (char_length(adset_id) <= 80),
  ad_id        text check (char_length(ad_id) <= 80),
  contact_id   text check (char_length(contact_id) <= 80),
  page_url     text check (char_length(page_url) <= 500),
  assigned_by  uuid references public.profiles(id) on delete set null,
  assigned_at  timestamptz
);
create index if not exists lead_intake_lead_idx on public.lead_intake (lead_id);
create index if not exists lead_intake_routing_idx on public.lead_intake (routing, received_at desc);
comment on table public.lead_intake is
  'P858: how each engine lead routed (agent ID from the ad link, Meta option, ad IDs). Admins only.';

alter table public.lead_intake enable row level security;
revoke all on public.lead_intake from public, anon, authenticated;
grant select on public.lead_intake to authenticated;
create policy lead_intake_admin_read on public.lead_intake
  for select to authenticated using (public.is_admin());

-- The engine's posted lead → one Ohvara lead. Returns { lead_id, routing, agent_id, duplicate }.
-- p: { intake_key, agent_id, lead_type ('booked_appointment' | 'live_call'), meta_option, first_name, last_name,
--      phone, email, state, postal_code, campaign_id, adset_id, ad_id, contact_id, page_url, consent_at,
--      consent_text_version, answers {} }
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
    insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url)
    values (v_key, v_lead, v_ref, 'duplicate', v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
            left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500));
    return jsonb_build_object('lead_id', v_lead, 'routing', 'duplicate', 'duplicate', true);
  end if;

  -- 3. Who it goes to: the agent in the ad link, if they can take it.
  if v_ref is null then
    v_route := 'missing';
  elsif v_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not exists (select 1 from profiles where id = v_ref::uuid and role = 'agent') then
    v_route := 'unknown';
  elsif not exists (select 1 from profiles where id = v_ref::uuid and role = 'agent' and is_active) then
    v_route := 'inactive';
  else
    v_agent := v_ref::uuid;
    -- Same test as assign_lead: one of the agent's states, and (once P881 is on) a verified licence there.
    v_ok := v_state is not null
            and exists (select 1 from agent_lead_settings s where s.agent_id = v_agent and v_state = any (s.states));
    if v_ok and to_regprocedure('public.licence_allows(uuid,text)') is not null then
      execute 'select public.licence_allows($1, $2)' into v_ok using v_agent, v_state;
    end if;
    if coalesce(v_ok, false) then v_route := 'matched'; else v_route := 'unlicensed'; v_agent := null; end if;
  end if;

  insert into leads (lead_type, lead_source, business_name, contact_name, phone, email, state, qualifier_answers, is_sample)
  values (
    case v_kind when 'live_call' then 'policy_help' else 'mortgage_protection' end, 'meta', v_name, v_name, v_phone,
    left(nullif(btrim(p->>'email'), ''), 200), v_state,
    jsonb_strip_nulls(jsonb_build_object(
      'consent_at', p->>'consent_at', 'consent_text_version', p->>'consent_text_version',
      'postal_code', left(p->>'postal_code', 10), 'source', 'ghl'
    )) || coalesce(case when jsonb_typeof(p->'answers') = 'object' then p->'answers' end, '{}'::jsonb),
    false)
  returning id into v_lead;

  if v_agent is not null then
    update leads set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
     where id = v_lead and assigned_rep_id is null;
  end if;

  insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url)
  values (v_key, v_lead, v_ref, v_route, v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
          left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500));

  return jsonb_build_object('lead_id', v_lead, 'routing', v_route, 'agent_id', v_agent, 'duplicate', false);
end;
$$;
revoke execute on function public.ghl_intake_lead(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_intake_lead(jsonb) to service_role;

-- The Unassigned lane: typed engine/web leads with no agent, newest first.
create or replace function public.admin_unassigned_leads()
 returns table (lead_id uuid, name text, phone text, state text, lead_kind text, created_at timestamptz,
                routing text, agent_ref text, meta_option text, campaign_id text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select l.id, l.contact_name, l.phone, l.state, l.inbound_product, l.created_at, i.routing, i.agent_ref, i.meta_option, i.campaign_id
    from leads l
    left join lateral (select * from lead_intake x where x.lead_id = l.id and x.routing <> 'duplicate' order by x.id limit 1) i on true
   where public.is_admin()
     and l.lead_type in ('mortgage_protection', 'policy_help')
     and l.assigned_rep_id is null
     and not coalesce(l.is_sample, false)
   order by l.created_at desc
   limit 200
$$;
revoke execute on function public.admin_unassigned_leads() from public, anon;
grant  execute on function public.admin_unassigned_leads() to authenticated;

-- Admin "Assign to…": an unassigned (or someone else's) typed lead to an active agent. Audit-logged.
create or replace function public.admin_assign_lead(p_lead uuid, p_agent uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_old uuid;
  v_me  uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_agent and role = 'agent' and is_active) then
    raise exception 'not an active agent' using errcode = '22023';
  end if;
  select assigned_rep_id into v_old from leads
   where id = p_lead and lead_type in ('mortgage_protection', 'policy_help') for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if v_old = p_agent then return; end if;

  update leads set assigned_rep_id = p_agent, delivered_at = coalesce(delivered_at, now()),
         agent_status = 'assigned'
   where id = p_lead;
  update lead_intake set routing = 'assigned', assigned_by = v_me, assigned_at = now()
   where lead_id = p_lead and routing <> 'duplicate';

  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, old_values, new_values)
  values (v_me, (select full_name from profiles where id = v_me), 'admin_assign_lead',
          case when v_old is null then 'route_lead' else 'move_lead' end, 'leads', p_lead::text,
          jsonb_build_object('assigned_rep_id', v_old), jsonb_build_object('assigned_rep_id', p_agent));
end;
$$;
revoke execute on function public.admin_assign_lead(uuid, uuid) from public, anon;
grant  execute on function public.admin_assign_lead(uuid, uuid) to authenticated;

-- ── campaign → agent ────────────────────────────────────────────────────────
create table if not exists public.ghl_campaign_agents (
  campaign_id    text primary key check (char_length(campaign_id) between 1 and 80),
  campaign_name  text check (char_length(campaign_name) <= 200),
  fb_campaign_id text check (char_length(fb_campaign_id) <= 80),
  agent_id       uuid references public.profiles(id) on delete set null,
  lead_type      text check (lead_type in ('appts', 'live')),
  status         text check (char_length(status) <= 40),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  mapped_by      uuid references public.profiles(id) on delete set null,
  mapped_at      timestamptz
);
-- One Meta campaign per agent and lead type.
create unique index if not exists ghl_campaign_agents_one_per_agent
  on public.ghl_campaign_agents (agent_id, coalesce(lead_type, 'appts')) where agent_id is not null;
comment on table public.ghl_campaign_agents is 'P858: Meta campaign (from GHL Ad Manager) → the agent it buys leads for. Admins only.';

alter table public.ghl_campaign_agents enable row level security;
revoke all on public.ghl_campaign_agents from public, anon, authenticated;
grant select on public.ghl_campaign_agents to authenticated;
create policy ghl_campaign_agents_admin_read on public.ghl_campaign_agents
  for select to authenticated using (public.is_admin());
drop trigger if exists ghl_campaign_agents_audit on public.ghl_campaign_agents;
create trigger ghl_campaign_agents_audit after update on public.ghl_campaign_agents
  for each row execute function public.audit_row('agent_id', 'lead_type');

-- Map (or clear, with null) a campaign's agent. Unknown campaign IDs are added so Jordan can map before the first pull.
create or replace function public.admin_map_campaign(p_campaign text, p_agent uuid, p_lead_type text default 'appts')
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_campaign is null or btrim(p_campaign) = '' then raise exception 'campaign is required' using errcode = '22004'; end if;
  if p_lead_type not in ('appts', 'live') then raise exception 'bad lead type' using errcode = '22023'; end if;
  if p_agent is not null and not exists (select 1 from profiles where id = p_agent and role = 'agent') then
    raise exception 'not an agent' using errcode = '22023';
  end if;
  insert into ghl_campaign_agents (campaign_id, agent_id, lead_type, mapped_by, mapped_at)
  values (btrim(p_campaign), p_agent, p_lead_type, auth.uid(), now())
  on conflict (campaign_id) do update
     set agent_id = excluded.agent_id, lead_type = excluded.lead_type, mapped_by = excluded.mapped_by, mapped_at = excluded.mapped_at;
  -- Spend already pulled for the campaign follows the new owner.
  update ad_spend_daily set agent_id = p_agent where campaign_id = btrim(p_campaign);
end;
$$;

-- ── ad spend ────────────────────────────────────────────────────────────────
create table if not exists public.ad_spend_daily (
  campaign_id  text not null references public.ghl_campaign_agents(campaign_id) on delete cascade,
  spend_date   date not null,
  agent_id     uuid references public.profiles(id) on delete set null,
  spend_cents  bigint not null default 0 check (spend_cents >= 0),
  impressions  bigint not null default 0 check (impressions >= 0),
  clicks       bigint not null default 0 check (clicks >= 0),
  leads        int    not null default 0 check (leads >= 0),
  pulled_at    timestamptz not null default now(),
  primary key (campaign_id, spend_date)
);
create index if not exists ad_spend_daily_agent_idx on public.ad_spend_daily (agent_id, spend_date);
comment on table public.ad_spend_daily is 'P858: spend per Meta campaign per day from GHL Ad Manager (ghl-ad-spend). Admins only.';

alter table public.ad_spend_daily enable row level security;
revoke all on public.ad_spend_daily from public, anon, authenticated;
grant select on public.ad_spend_daily to authenticated;
create policy ad_spend_daily_admin_read on public.ad_spend_daily
  for select to authenticated using (public.is_admin());

revoke execute on function public.admin_map_campaign(text, uuid, text) from public, anon;
grant  execute on function public.admin_map_campaign(text, uuid, text) to authenticated;

-- ghl-ad-spend's write: p_rows = [{ campaign_id, campaign_name, fb_campaign_id, status, date, spend_cents,
-- impressions, clicks, leads }]. Upserts the campaign list and that day's numbers, stamps the sync status,
-- and (only with ad_spend_bills_agents on and the P884 ledger present) feeds each mapped agent's delivered
-- spend for the day into lead_spend_record_delivered. Returns { campaigns, rows, unmapped, billed }.
create or replace function public.ghl_ad_spend_save(p_rows jsonb, p_status text, p_error text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  r jsonb;
  n_rows int := 0;
  n_unmapped int := 0;
  n_billed int := 0;
  bill boolean;
  t record;
begin
  if p_status not in ('ok', 'error', 'off', 'not_configured') then raise exception 'bad status'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    continue when nullif(r->>'campaign_id', '') is null or nullif(r->>'date', '') is null;
    insert into ghl_campaign_agents (campaign_id, campaign_name, fb_campaign_id, status, last_seen_at)
    values (r->>'campaign_id', left(r->>'campaign_name', 200), left(r->>'fb_campaign_id', 80), left(r->>'status', 40), now())
    on conflict (campaign_id) do update
       set campaign_name = coalesce(excluded.campaign_name, ghl_campaign_agents.campaign_name),
           fb_campaign_id = coalesce(excluded.fb_campaign_id, ghl_campaign_agents.fb_campaign_id),
           status = coalesce(excluded.status, ghl_campaign_agents.status), last_seen_at = now();
    insert into ad_spend_daily (campaign_id, spend_date, agent_id, spend_cents, impressions, clicks, leads, pulled_at)
    select r->>'campaign_id', (r->>'date')::date, m.agent_id,
           greatest(0, coalesce((r->>'spend_cents')::bigint, 0)), greatest(0, coalesce((r->>'impressions')::bigint, 0)),
           greatest(0, coalesce((r->>'clicks')::bigint, 0)), greatest(0, coalesce((r->>'leads')::int, 0)), now()
      from ghl_campaign_agents m where m.campaign_id = r->>'campaign_id'
    on conflict (campaign_id, spend_date) do update
       set agent_id = excluded.agent_id, spend_cents = excluded.spend_cents, impressions = excluded.impressions,
           clicks = excluded.clicks, leads = excluded.leads, pulled_at = now();
    n_rows := n_rows + 1;
    if not exists (select 1 from ghl_campaign_agents where campaign_id = r->>'campaign_id' and agent_id is not null) then
      n_unmapped := n_unmapped + 1;
    end if;
  end loop;

  select ad_spend_bills_agents into bill from ghl_settings where id;
  if coalesce(bill, false) and to_regprocedure('public.lead_spend_record_delivered(uuid,text,date,integer,text)') is not null then
    for t in
      select d.agent_id, coalesce(m.lead_type, 'appts') as lt, d.spend_date, sum(d.spend_cents)::int as cents
        from ad_spend_daily d join ghl_campaign_agents m using (campaign_id)
       where d.agent_id is not null
         and d.spend_date in (select distinct (x->>'date')::date from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where nullif(x->>'date', '') is not null)
       group by 1, 2, 3
    loop
      execute 'select public.lead_spend_record_delivered($1, $2, $3, $4, $5)' using t.agent_id, t.lt, t.spend_date, t.cents, 'ghl';
      n_billed := n_billed + 1;
    end loop;
  end if;

  update ghl_settings set ad_spend_last_at = now(), ad_spend_last_status = p_status, ad_spend_last_error = left(p_error, 500) where id;
  return jsonb_build_object('rows', n_rows, 'unmapped', n_unmapped, 'billed', n_billed);
end;
$$;
revoke execute on function public.ghl_ad_spend_save(jsonb, text, text) from public, anon, authenticated;
grant  execute on function public.ghl_ad_spend_save(jsonb, text, text) to service_role;

-- Cost per lead / booked / sale per agent over [p_from, p_to] (dates in Central time), from real spend and real
-- outcomes. Booked = an appointment lead that reached booked or later, or a live call that was transferred.
create or replace function public.admin_ad_costs(p_from date, p_to date)
 returns table (agent_id uuid, agent_name text, spend_cents bigint, impressions bigint, clicks bigint,
                leads int, booked int, sold int)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  with s as (
    select d.agent_id, sum(d.spend_cents)::bigint sc, sum(d.impressions)::bigint im, sum(d.clicks)::bigint cl
      from ad_spend_daily d where d.spend_date between p_from and p_to and d.agent_id is not null group by 1
  ), o as (
    select l.assigned_rep_id agent_id, count(*)::int n,
           count(*) filter (where l.inbound_stage in ('booked', 'met', 'sold')
                               or l.transfer_status in ('requested', 'connected'))::int b,
           count(*) filter (where l.outcome = 'sold' or l.inbound_stage = 'sold')::int so
      from leads l
     where l.lead_type in ('mortgage_protection', 'policy_help') and l.assigned_rep_id is not null
       and not coalesce(l.is_sample, false)
       and (l.delivered_at at time zone 'America/Chicago')::date between p_from and p_to
     group by 1
  )
  select p.id, p.full_name, coalesce(s.sc, 0), coalesce(s.im, 0), coalesce(s.cl, 0), coalesce(o.n, 0), coalesce(o.b, 0), coalesce(o.so, 0)
    from profiles p left join s on s.agent_id = p.id left join o on o.agent_id = p.id
   where public.is_admin() and p.role = 'agent' and (s.agent_id is not null or o.agent_id is not null)
   order by coalesce(s.sc, 0) desc
$$;
revoke execute on function public.admin_ad_costs(date, date) from public, anon;
grant  execute on function public.admin_ad_costs(date, date) to authenticated;

-- ── Setup: the steps admins tick (Jordan's and Ohvara's), Mark launched / Mark live ─────────────────────────
-- The agent's own steps (profile, plan, paid, calendar, caller ID, alerts, transfers) are read from their real
-- records by the admin page; only the GoHighLevel and Ohvara steps are ticked by hand and stored here.
create table if not exists public.agent_setup_ticks (
  agent_id  uuid not null references public.profiles(id) on delete cascade,
  step      text not null check (step in ('campaign', 'budget', 'mapped', 'link', 'tracking', 'workflows', 'briefed', 'test', 'live')),
  done_by   uuid references public.profiles(id) on delete set null,
  done_at   timestamptz not null default now(),
  primary key (agent_id, step)
);
comment on table public.agent_setup_ticks is 'P858: Setup steps ticked by admins (Jordan''s GoHighLevel steps and Ohvara''s). Admins only.';
alter table public.agent_setup_ticks enable row level security;
revoke all on public.agent_setup_ticks from public, anon, authenticated;
grant select on public.agent_setup_ticks to authenticated;
create policy agent_setup_ticks_admin_read on public.agent_setup_ticks
  for select to authenticated using (public.is_admin());

create or replace function public.admin_setup_tick(p_agent uuid, p_step text, p_on boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_step = 'live' then raise exception 'use admin_mark_live' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_agent and role = 'agent') then raise exception 'not an agent' using errcode = '22023'; end if;
  if p_on then
    insert into agent_setup_ticks (agent_id, step, done_by) values (p_agent, p_step, v_me) on conflict do nothing;
  else
    delete from agent_setup_ticks where agent_id = p_agent and step = p_step;
  end if;
  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, new_values)
  values (v_me, (select full_name from profiles where id = v_me), 'admin_setup_tick', case when p_on then 'setup_tick' else 'setup_untick' end,
          'agent_setup_ticks', p_agent::text, jsonb_build_object('step', p_step));
end;
$$;
revoke execute on function public.admin_setup_tick(uuid, text, boolean) from public, anon;
grant  execute on function public.admin_setup_tick(uuid, text, boolean) to authenticated;

-- Mark live: the agent starts taking leads (agent_lead_settings.active) and the Live tick is stamped. Audit-logged.
create or replace function public.admin_mark_live(p_agent uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_agent and role = 'agent' and is_active) then raise exception 'not an active agent' using errcode = '22023'; end if;
  if not exists (select 1 from agent_lead_settings where agent_id = p_agent and cardinality(states) > 0) then
    raise exception 'no states set' using errcode = '22023';
  end if;
  update agent_lead_settings set active = true, updated_at = now() where agent_id = p_agent;
  insert into agent_setup_ticks (agent_id, step, done_by) values (p_agent, 'live', v_me) on conflict do nothing;
  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, new_values)
  values (v_me, (select full_name from profiles where id = v_me), 'admin_mark_live', 'mark_live', 'profiles', p_agent::text, jsonb_build_object('live', true));
end;
$$;
revoke execute on function public.admin_mark_live(uuid) from public, anon;
grant  execute on function public.admin_mark_live(uuid) to authenticated;
