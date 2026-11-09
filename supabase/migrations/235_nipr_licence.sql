-- P881 — Licence check: the NPN against NIPR, only verified states, the daily re-check, and the gates.
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it (Parallel rule 4). Additive only: new
-- columns, tables, functions, triggers, four notification types, one private storage bucket and two cron jobs.
-- Nothing is dropped, renamed or emptied. assign_lead (173) is re-created with one added line (the gate).
--
-- APPLY ORDER: after 091 (agent_licenses, profiles.npn), 146/156 (notify), 161/173 (agent_lead_settings,
-- assign_lead), 145 (fulfillment_cron_post / fulfillment_cron_ok) and 230 (ghl, for the targeting hand-off).
--
-- How it fits together (How Ohvara Works → H setup, A ads, C hand-off; Q61):
--   nipr-check (edge function)  looks the NPN up on NIPR, judges it (found, name, life line, other account) and
--                               hands the result to licence_apply_check(). Daily, it re-checks every agent.
--   agent_licenses              one row per state. verified + life_active + not lapsed + not expired = a state
--                               the agent may get leads, bookings and transfers in. Only nipr-check (service
--                               role) and an admin review can set verified; an agent's own write never can.
--   licence_settings.gate_on    the switch. OFF on apply, so nothing changes for agents who haven't been
--                               checked yet. While off, only New York is blocked (Q61). Brayden turns it on once
--                               agents are verified (NIPR or review). On = only verified states, everywhere.
--   licence_reviews             NPN not found, NIPR down, a name mismatch or an NPN already on another account
--                               go to an admin with the agent's upload. The other setup steps carry on; the
--                               launch waits (licence_ready).
--   licence_daily_sweep()       7 AM Central: expired licences lapse (the state drops, agent + admins told,
--                               all lapsed = leads paused, account kept), and 30/7-day expiry reminders.
--   agent_targeting_states      the verified states per agent for the ad engine (GoHighLevel, Jordan): a row
--                               changes the same day a state is verified or dropped; the engine pushes it and
--                               stamps pushed_at.

do $$
begin
  if to_regclass('public.agent_licenses') is null then raise exception 'p881 needs 091 applied first'; end if;
  if to_regclass('public.agent_lead_settings') is null then raise exception 'p881 needs 161/173 applied first'; end if;
  if to_regclass('public.notification_types') is null then raise exception 'p881 needs 146 applied first'; end if;
end $$;

-- ── 1. The switch ───────────────────────────────────────────────────────────
create table if not exists public.licence_settings (
  id          boolean primary key default true check (id),
  gate_on     boolean not null default false,
  not_taking  text[] not null default '{NY}'
                check (array_to_string(not_taking, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  updated_at  timestamptz not null default now()
);
insert into public.licence_settings (id) values (true) on conflict (id) do nothing;
alter table public.licence_settings enable row level security;
drop policy if exists licence_settings_read on public.licence_settings;
create policy licence_settings_read on public.licence_settings for select to authenticated using (true);
drop policy if exists licence_settings_admin on public.licence_settings;
create policy licence_settings_admin on public.licence_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.licence_settings from public, anon, authenticated;
grant select on public.licence_settings to authenticated;
grant update (gate_on, not_taking, updated_at) on public.licence_settings to authenticated;

create or replace function public.licence_gate_on() returns boolean language sql stable security definer
set search_path = public as $$ select coalesce((select gate_on from licence_settings where id), false) $$;
create or replace function public.licence_not_taking() returns text[] language sql stable security definer
set search_path = public as $$ select coalesce((select not_taking from licence_settings where id), '{NY}'::text[]) $$;

-- ── 2. What the registry said ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists npn_status text not null default 'unchecked',
  add column if not exists npn_name text,
  add column if not exists npn_checked_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_npn_status_check') then
    alter table public.profiles add constraint profiles_npn_status_check check (npn_status in
      ('unchecked', 'verified', 'no_life', 'not_found', 'registry_down', 'mismatch', 'duplicate', 'review', 'rejected'));
  end if;
end $$;
-- One verified NPN per account (N-H-08). Existing rows are all 'unchecked', so this can't fail on apply.
create unique index if not exists profiles_npn_verified_uidx on public.profiles (npn) where npn_status = 'verified';

alter table public.agent_licenses
  add column if not exists verified     boolean not null default false,
  add column if not exists life_active  boolean,
  add column if not exists source       text not null default 'self',
  add column if not exists checked_at   timestamptz,
  add column if not exists lapsed_at    timestamptz,
  add column if not exists lapse_reason text,
  add column if not exists updated_at   timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_licenses_source_check') then
    alter table public.agent_licenses add constraint agent_licenses_source_check check (source in ('self', 'nipr', 'review'));
  end if;
end $$;
create index if not exists agent_licenses_expiry_idx on public.agent_licenses (expires_on) where verified and lapsed_at is null;

comment on column public.agent_licenses.verified is
  'P881: set only by nipr-check (service role) or an admin review. An agent''s own insert/update always resets it.';

-- An agent writing their own licence rows (091's policy) can never mark one verified.
create or replace function public.agent_licenses_self_write() returns trigger language plpgsql
set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    new.verified := false; new.life_active := null; new.source := 'self'; new.checked_at := null;
    new.lapsed_at := null; new.lapse_reason := null;
  end if;
  new.state := upper(btrim(new.state));
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists agent_licenses_self_write on public.agent_licenses;
create trigger agent_licenses_self_write before insert or update on public.agent_licenses
  for each row execute function public.agent_licenses_self_write();

-- ── 3. The verified states ──────────────────────────────────────────────────
-- Active, life line, not lapsed, not expired, and not a state we don't take agents in (Q61: New York).
create or replace function public.licence_verified_states(p_agent uuid) returns text[] language sql stable
security definer set search_path = public as $$
  select coalesce(array_agg(distinct l.state order by l.state), '{}')
    from agent_licenses l
   where l.profile_id = p_agent and l.verified and coalesce(l.life_active, false) and l.lapsed_at is null
     and (l.expires_on is null or l.expires_on >= (now() at time zone 'America/Chicago')::date)
     and not (l.state = any (public.licence_not_taking()))
$$;

-- The one gate every path asks: leads, bookings, transfers. Gate off = everything but New York passes.
create or replace function public.licence_allows(p_agent uuid, p_state text) returns boolean language sql stable
security definer set search_path = public as $$
  select case
    when p_agent is null then false
    when upper(btrim(coalesce(p_state, ''))) = any (public.licence_not_taking()) then false
    when not public.licence_gate_on() then true
    when nullif(btrim(coalesce(p_state, '')), '') is null then false
    else upper(btrim(p_state)) = any (public.licence_verified_states(p_agent))
  end
$$;

-- Launch waits on this (N-H-09, N-H-23): a verified NPN with at least one verified state.
create or replace function public.licence_ready(p_agent uuid) returns boolean language sql stable
security definer set search_path = public as $$
  select coalesce((select npn_status = 'verified' from profiles where id = p_agent), false)
     and cardinality(public.licence_verified_states(p_agent)) > 0
$$;

-- ── 4. Ad targeting hand-off (N-A-05) ───────────────────────────────────────
create table if not exists public.agent_targeting_states (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  states      text[] not null default '{}',
  changed_at  timestamptz not null default now(),
  pushed_at   timestamptz
);
alter table public.agent_targeting_states enable row level security;
drop policy if exists ats_admin_read on public.agent_targeting_states;
create policy ats_admin_read on public.agent_targeting_states for select to authenticated using (public.is_admin());
revoke all on public.agent_targeting_states from public, anon, authenticated;
grant select on public.agent_targeting_states to authenticated;
comment on table public.agent_targeting_states is
  'P881 → GoHighLevel (Jordan): the states each agent''s campaign may target. Pending push = pushed_at is null or < changed_at.';

create or replace function public.licence_refresh_targeting(p_agent uuid) returns boolean language plpgsql
security definer set search_path = public as $$
declare v text[] := public.licence_verified_states(p_agent);
begin
  insert into agent_targeting_states (agent_id, states) values (p_agent, v)
  on conflict (agent_id) do update set states = excluded.states, changed_at = now()
   where agent_targeting_states.states is distinct from excluded.states;
  return found;
end; $$;

-- ── 5. Picking states for leads: only verified ones (N-H-07) ────────────────
-- 173 lets an agent write agent_lead_settings.states. A state added there must be verified while the gate is on,
-- and New York is never taken. States already on the row stay (a lapsed one simply stops passing the gate, and
-- comes back on its own when it's verified again).
create or replace function public.agent_lead_states_guard() returns trigger language plpgsql
set search_path = public as $$
declare bad text;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  select s into bad from unnest(new.states) s
   where not (s = any (coalesce(case when tg_op = 'UPDATE' then old.states end, '{}')))
     and (s = any (public.licence_not_taking())
          or (public.licence_gate_on() and not (s = any (public.licence_verified_states(new.agent_id)))))
   limit 1;
  if bad is not null then
    raise exception 'You can only pick states where your life licence is verified (%).', bad
      using errcode = 'P0001', hint = 'not_verified_state';
  end if;
  return new;
end; $$;
drop trigger if exists agent_lead_states_guard on public.agent_lead_settings;
create trigger agent_lead_states_guard before insert or update of states on public.agent_lead_settings
  for each row execute function public.agent_lead_states_guard();

-- ── 6. VA bookings: never into a state the agent can't sell in (N-C-22, N-A-12) ──
-- A VA's booking is the policies row Book a call writes (useBookCall). Agents' and admins' own writes are not
-- touched here (Submit checks the state on screen, N-D-06).
create or replace function public.policies_va_booking_licence() returns trigger language plpgsql
set search_path = public as $$
begin
  if new.scheduled_call_at is null or new.agent_id is null then return new; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'fulfillment') then return new; end if;
  if not public.licence_allows(new.agent_id, new.state) then
    raise exception '%', case when nullif(btrim(coalesce(new.state, '')), '') is null
        then 'Confirm the client''s state before booking.'
        else 'This agent isn''t licensed in ' || upper(new.state) || '. Don''t book; the team finds a licensed agent.' end
      using errcode = 'P0001', hint = 'not_licensed';
  end if;
  return new;
end; $$;
drop trigger if exists policies_va_booking_licence on public.policies;
create trigger policies_va_booking_licence before insert on public.policies
  for each row execute function public.policies_va_booking_licence();

-- ── 7. Leads: assign_lead (173) with the gate added ─────────────────────────
-- Unchanged from 173 except the marked line: an agent only gets a lead in a state the gate allows.
create or replace function public.assign_lead(p_lead_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_lead      record;
  v_state     text;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Chicago')) at time zone 'America/Chicago';
  v_agent     uuid;
begin
  if p_lead_id is null then
    raise exception 'lead_id is required' using errcode = '22004';
  end if;

  select id, state, lead_type, assigned_rep_id into v_lead
    from leads where id = p_lead_id
    for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'Lead % is a cancellation lead', p_lead_id using errcode = '22023';
  end if;
  if v_lead.assigned_rep_id is not null then
    return v_lead.assigned_rep_id;
  end if;

  v_state := upper(btrim(v_lead.state));
  if v_state is null or v_state = '' then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assign_lead', 0));

  select s.agent_id into v_agent
    from agent_lead_settings s
    join profiles p on p.id = s.agent_id and p.role = 'agent' and p.is_active
    cross join lateral (
      select count(*) filter (where l.delivered_at >= v_day_start) as today,
             max(l.delivered_at) as last_at
        from leads l
       where l.assigned_rep_id = s.agent_id
         and l.lead_type <> 'cancellation'
         and l.delivered_at is not null
    ) c
   where s.active
     and v_state = any (s.states)
     and public.licence_allows(s.agent_id, v_state)          -- P881: verified states only
     and (s.daily_cap is null or c.today < s.daily_cap)
   order by c.today, c.last_at asc nulls first, s.agent_id
   limit 1;

  if v_agent is null then
    return null;
  end if;

  update leads
     set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
   where id = p_lead_id and assigned_rep_id is null;

  return v_agent;
end;
$$;
revoke execute on function public.assign_lead(uuid) from public, anon, authenticated;
grant  execute on function public.assign_lead(uuid) to service_role;

-- ── 8. Notifications ────────────────────────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, v.roles, v.label, true, 'notify', true, v.push, false, true,
       coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values
    ('licence_lapsed',   array['agent', 'admin'], 'A licence lapsed: that state stopped', true, 1),
    ('licence_expiring', array['agent', 'admin'], 'A licence expires soon',               false, 2),
    ('licence_review',   array['admin'],          'A licence needs a manual check',      true, 3),
    ('licence_verified', array['agent'],          'Licence checked',                     false, 4)
  ) as v(type, roles, label, push, n)
 where not exists (select 1 from public.notification_types t where t.type = v.type);

create or replace function public.licence_notify_admins(p_type text, p_title text, p_detail text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare adm uuid;
begin
  for adm in select id from profiles where role = 'admin' and coalesce(is_active, true) loop
    perform public.notify(adm, p_type, p_title, p_detail, '/admin', true, p_dedupe || ':' || adm);
  end loop;
end; $$;

-- A state dropped: lapse it, tell the agent and every admin; nothing left = leads paused (account kept).
create or replace function public.licence_lapse(p_licence uuid, p_reason text) returns void language plpgsql
security definer set search_path = public as $$
declare l agent_licenses; who text;
begin
  update agent_licenses set lapsed_at = now(), lapse_reason = p_reason
   where id = p_licence and lapsed_at is null returning * into l;
  if l.id is null then return; end if;
  select coalesce(split_part(full_name, ' ', 1), 'An agent') into who from profiles where id = l.profile_id;
  perform public.notify(l.profile_id, 'licence_lapsed', 'Leads stopped in ' || l.state,
    case when cardinality(public.licence_verified_states(l.profile_id)) = 0
      then 'Your ' || l.state || ' life licence is no longer active, and it was your last one, so new leads are paused. Your account and clients stay. Renew it and we''ll pick it up on the next daily check.'
      else 'Your ' || l.state || ' life licence is no longer active, so no new leads, bookings or transfers in ' || l.state || '. Renew it and we''ll pick it up on the next daily check.' end,
    '/settings?tab=licence', true, 'lapse:' || l.id || ':' || current_date);
  perform public.licence_notify_admins('licence_lapsed', who || '''s ' || l.state || ' licence lapsed',
    case p_reason when 'expired' then 'It passed its expiry date.' else 'NIPR no longer shows an active life licence there.' end
      || case when cardinality(public.licence_verified_states(l.profile_id)) = 0 then ' No verified states left: their leads are paused.' else ' That state is off their leads and ads.' end,
    'lapse:' || l.id || ':' || current_date);
end; $$;

-- ── 9. Applying a check (nipr-check, service role only) ─────────────────────
-- p_status from the function: verified | no_life | not_found | registry_down | mismatch.
-- p_licences: [{ state, active, life, expires_on, number }] exactly as NIPR listed them.
-- Returns the agent's licence view (my_licence shape).
create or replace function public.licence_apply_check(p_agent uuid, p_npn text, p_status text, p_name text,
  p_licences jsonb default '[]'::jsonb, p_daily boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text := p_status;
  r jsonb; l agent_licenses; v_state text; v_ok boolean;
begin
  if p_status not in ('verified', 'no_life', 'not_found', 'registry_down', 'mismatch') then
    raise exception 'bad status %', p_status;
  end if;
  if p_npn !~ '^\d{6,10}$' then raise exception 'bad npn'; end if;
  -- NIPR down: never drop anything on an outage; only a first check records it.
  if p_status = 'registry_down' then
    if not p_daily then
      update profiles set npn = p_npn, npn_status = 'registry_down', npn_checked_at = now()
       where id = p_agent and npn_status <> 'verified';
    end if;
    return public.licence_view(p_agent);
  end if;
  -- Already verified on another account (N-H-08): nothing is written to licences; an admin decides.
  if p_status = 'verified' and exists (select 1 from profiles where npn = p_npn and npn_status = 'verified' and id <> p_agent) then
    v_status := 'duplicate';
  end if;

  update profiles set npn = p_npn,
         npn_status = case when not p_daily then v_status when v_status in ('verified', 'no_life') then v_status else npn_status end,
         npn_name = coalesce(p_name, npn_name), npn_checked_at = now()
   where id = p_agent;

  if v_status in ('verified', 'no_life') then
    for r in select * from jsonb_array_elements(coalesce(p_licences, '[]'::jsonb)) loop
      v_state := upper(btrim(r->>'state'));
      continue when v_state !~ '^[A-Z]{2}$';
      v_ok := coalesce((r->>'active')::boolean, false) and coalesce((r->>'life')::boolean, false)
              and (nullif(r->>'expires_on', '') is null or (r->>'expires_on')::date >= current_date);
      select * into l from agent_licenses where profile_id = p_agent and state = v_state
       order by verified desc, updated_at desc limit 1;
      if l.id is null then
        insert into agent_licenses (profile_id, state, license_number, expires_on, verified, life_active, source, checked_at)
        values (p_agent, v_state, nullif(r->>'number', ''), nullif(r->>'expires_on', '')::date, true, v_ok, 'nipr', now());
      else
        -- A state that was good and isn't any more lapses (daily re-check, N-A-06).
        if l.verified and coalesce(l.life_active, false) and l.lapsed_at is null and not v_ok then
          perform public.licence_lapse(l.id, 'nipr_inactive');
        end if;
        update agent_licenses set license_number = coalesce(nullif(r->>'number', ''), license_number),
               expires_on = nullif(r->>'expires_on', '')::date, verified = true, life_active = v_ok, source = 'nipr',
               checked_at = now(), lapsed_at = case when v_ok then null else lapsed_at end,
               lapse_reason = case when v_ok then null else lapse_reason end
         where id = l.id;
      end if;
    end loop;
    -- States we had verified that NIPR no longer lists at all.
    for l in select * from agent_licenses a where a.profile_id = p_agent and a.verified and a.source = 'nipr'
               and a.lapsed_at is null and coalesce(a.life_active, false)
               and not exists (select 1 from jsonb_array_elements(coalesce(p_licences, '[]'::jsonb)) x
                                where upper(btrim(x->>'state')) = a.state) loop
      perform public.licence_lapse(l.id, 'nipr_inactive');
      update agent_licenses set life_active = false, checked_at = now() where id = l.id;
    end loop;
  end if;

  if v_status in ('mismatch', 'duplicate') and not p_daily
     and not exists (select 1 from licence_reviews where profile_id = p_agent and status = 'open') then
    insert into licence_reviews (profile_id, npn, reason, registry_name, states)
    values (p_agent, p_npn, v_status, p_name,
            coalesce((select array_agg(distinct upper(x->>'state')) from jsonb_array_elements(coalesce(p_licences, '[]'::jsonb)) x), '{}'));
    perform public.licence_notify_admins('licence_review', 'Licence to check by hand',
      case v_status when 'duplicate' then 'An NPN already verified on another account was entered.' else 'The name on NIPR doesn''t match the account.' end,
      'review:' || p_agent || ':' || current_date);
  end if;

  if v_status = 'verified' and not p_daily then
    perform public.notify(p_agent, 'licence_verified', 'Licence checked',
      'We found your NPN. Leads come only from the verified states you pick.', '/settings?tab=licence', false,
      'verified:' || p_agent || ':' || current_date);
  end if;
  perform public.licence_refresh_targeting(p_agent);
  return public.licence_view(p_agent);
end; $$;

-- ── 10. Manual review (N-H-09: not found / NIPR down; N-H-08: mismatch / other account) ──
create table if not exists public.licence_reviews (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  npn            text,
  reason         text not null check (reason in ('not_found', 'registry_down', 'mismatch', 'duplicate', 'other')),
  registry_name  text,
  states         text[] not null default '{}',
  document_path  text,                 -- licence-docs/<agent id>/<file>
  note           text check (char_length(note) <= 1000),
  status         text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (char_length(decision_note) <= 1000),
  created_at     timestamptz not null default now()
);
create index if not exists licence_reviews_open_idx on public.licence_reviews (created_at) where status = 'open';
alter table public.licence_reviews enable row level security;
drop policy if exists licence_reviews_own on public.licence_reviews;
create policy licence_reviews_own on public.licence_reviews for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
revoke all on public.licence_reviews from public, anon, authenticated;
grant select on public.licence_reviews to authenticated;

create or replace function public.licence_review_request(p_reason text, p_states text[] default '{}',
  p_document_path text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_npn text;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role = 'agent') then
    raise exception 'Agents only' using errcode = '42501';
  end if;
  if p_reason not in ('not_found', 'registry_down', 'other') then raise exception 'bad reason'; end if;
  if p_document_path is not null and p_document_path not like auth.uid()::text || '/%' then
    raise exception 'Upload into your own folder' using errcode = '42501';
  end if;
  select npn into v_npn from profiles where id = auth.uid();
  select id into v_id from licence_reviews where profile_id = auth.uid() and status = 'open';
  if v_id is not null then
    update licence_reviews set reason = p_reason, document_path = coalesce(p_document_path, document_path),
           note = coalesce(p_note, note), states = coalesce(nullif(p_states, '{}'), states), npn = v_npn
     where id = v_id;
  else
    insert into licence_reviews (profile_id, npn, reason, states, document_path, note)
    values (auth.uid(), v_npn, p_reason,
            coalesce((select array_agg(distinct upper(s)) from unnest(p_states) s where upper(s) ~ '^[A-Z]{2}$'), '{}'),
            p_document_path, p_note)
    returning id into v_id;
    perform public.licence_notify_admins('licence_review', 'Licence to check by hand',
      case p_reason when 'not_found' then 'NIPR didn''t find their NPN; they sent their licence.'
                    when 'registry_down' then 'NIPR wasn''t answering; they sent their licence.'
                    else 'They asked for a manual licence check.' end,
      'review:' || auth.uid() || ':' || current_date);
  end if;
  update profiles set npn_status = 'review' where id = auth.uid() and npn_status <> 'verified';
  return v_id;
end; $$;

-- Admin decides. p_licences: [{ state, expires_on, number }] — the states the admin saw an active life licence for.
create or replace function public.admin_licence_review_decide(p_review uuid, p_approve boolean,
  p_licences jsonb default '[]'::jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare rv licence_reviews; r jsonb; v_state text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into rv from licence_reviews where id = p_review for update;
  if rv.id is null or rv.status <> 'open' then raise exception 'Review not open' using errcode = 'P0002'; end if;
  if p_approve and jsonb_array_length(coalesce(p_licences, '[]'::jsonb)) = 0 then
    raise exception 'List at least one licensed state to approve';
  end if;
  update licence_reviews set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_review;
  if p_approve then
    for r in select * from jsonb_array_elements(p_licences) loop
      v_state := upper(btrim(r->>'state'));
      continue when v_state !~ '^[A-Z]{2}$';
      delete from agent_licenses where profile_id = rv.profile_id and state = v_state and not verified;
      if exists (select 1 from agent_licenses where profile_id = rv.profile_id and state = v_state) then
        update agent_licenses set verified = true, life_active = true, source = 'review', checked_at = now(),
               lapsed_at = null, lapse_reason = null, expires_on = nullif(r->>'expires_on', '')::date,
               license_number = coalesce(nullif(r->>'number', ''), license_number)
         where profile_id = rv.profile_id and state = v_state;
      else
        insert into agent_licenses (profile_id, state, license_number, expires_on, verified, life_active, source, checked_at)
        values (rv.profile_id, v_state, nullif(r->>'number', ''), nullif(r->>'expires_on', '')::date, true, true, 'review', now());
      end if;
    end loop;
    update profiles set npn_status = 'verified', npn_checked_at = now() where id = rv.profile_id;
    perform public.notify(rv.profile_id, 'licence_verified', 'Licence checked',
      'An admin checked your licence. Leads come only from the verified states you pick.', '/settings?tab=licence', false,
      'reviewed:' || rv.id);
  else
    update profiles set npn_status = 'rejected' where id = rv.profile_id and npn_status <> 'verified';
    perform public.notify(rv.profile_id, 'licence_verified', 'We couldn''t verify your licence',
      coalesce(p_note, 'Check your NPN and try again, or talk to us.'), '/settings?tab=licence', true, 'reviewed:' || rv.id);
  end if;
  perform public.licence_refresh_targeting(rv.profile_id);
end; $$;

-- Private uploads: <agent id>/<file>. The agent writes and reads their own; admins read all.
insert into storage.buckets (id, name, public) values ('licence-docs', 'licence-docs', false) on conflict (id) do nothing;
drop policy if exists licence_docs_own_insert on storage.objects;
create policy licence_docs_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'licence-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists licence_docs_read on storage.objects;
create policy licence_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'licence-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ── 11. Changing the NPN resets the check ───────────────────────────────────
create or replace function public.profiles_npn_changed() returns trigger language plpgsql
set search_path = public as $$
begin
  if new.npn is distinct from old.npn and current_user in ('authenticated', 'anon') then
    new.npn_status := 'unchecked'; new.npn_name := null; new.npn_checked_at := null;
    update agent_licenses set verified = false where profile_id = new.id and verified;
    perform public.licence_refresh_targeting(new.id);
  end if;
  -- Only nipr-check and admins set the status.
  if current_user in ('authenticated', 'anon') and not public.is_admin()
     and new.npn is not distinct from old.npn then
    new.npn_status := old.npn_status; new.npn_name := old.npn_name; new.npn_checked_at := old.npn_checked_at;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_npn_changed on public.profiles;
create trigger profiles_npn_changed before update of npn, npn_status, npn_name, npn_checked_at on public.profiles
  for each row execute function public.profiles_npn_changed();

-- ── 12. What the agent screen reads ─────────────────────────────────────────
create or replace function public.licence_view(p_agent uuid) returns jsonb language sql stable
security definer set search_path = public as $$
  select jsonb_build_object(
    'npn', p.npn, 'status', p.npn_status, 'name', p.npn_name, 'checked_at', p.npn_checked_at,
    'gate_on', public.licence_gate_on(), 'not_taking', to_jsonb(public.licence_not_taking()),
    'states', to_jsonb(public.licence_verified_states(p.id)), 'ready', public.licence_ready(p.id),
    'licences', coalesce((select jsonb_agg(jsonb_build_object('state', l.state, 'active', coalesce(l.life_active, false),
        'life', coalesce(l.life_active, false), 'verified', l.verified, 'expires_on', l.expires_on, 'number', l.license_number,
        'source', l.source, 'lapsed_at', l.lapsed_at, 'lapse_reason', l.lapse_reason) order by l.state)
      from agent_licenses l where l.profile_id = p.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at)
                 from licence_reviews r where r.profile_id = p.id order by r.created_at desc limit 1))
    from profiles p where p.id = p_agent
$$;
create or replace function public.my_licence() returns jsonb language sql stable security definer
set search_path = public as $$ select public.licence_view(auth.uid()) $$;

-- ── 13. Daily: expiry lapses and reminders (N-A-06, N-H-12) ─────────────────
create or replace function public.licence_daily_sweep() returns int language plpgsql
security definer set search_path = public as $$
declare l record; n int := 0; today date := (now() at time zone 'America/Chicago')::date; d int; who text;
begin
  for l in select * from agent_licenses where verified and lapsed_at is null and coalesce(life_active, false)
             and expires_on is not null and expires_on < today loop
    perform public.licence_lapse(l.id, 'expired');
    perform public.licence_refresh_targeting(l.profile_id);
    n := n + 1;
  end loop;
  for l in select * from agent_licenses where verified and lapsed_at is null and coalesce(life_active, false)
             and expires_on between today and today + 30 loop
    d := l.expires_on - today;
    perform public.notify(l.profile_id, 'licence_expiring', 'Your ' || l.state || ' licence expires ' || to_char(l.expires_on, 'Mon FMDD'),
      'Renew it before then, or leads in ' || l.state || ' stop that day. We pick up the renewal on the next daily check.',
      '/settings?tab=licence', true, 'licexp:' || l.id || ':' || l.expires_on || ':' || case when d <= 7 then 7 else 30 end);
    if d <= 7 then
      select coalesce(split_part(full_name, ' ', 1), 'An agent') into who from profiles where id = l.profile_id;
      perform public.licence_notify_admins('licence_expiring', who || '''s ' || l.state || ' licence expires in ' || d || ' days',
        'If it isn''t renewed, ' || l.state || ' drops off their leads that day.', 'licexp:' || l.id || ':' || l.expires_on);
    end if;
  end loop;
  return n;
end; $$;

-- ── 14. Grants ──────────────────────────────────────────────────────────────
revoke execute on function public.licence_apply_check(uuid, text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.licence_daily_sweep() from public, anon, authenticated;
revoke execute on function public.licence_lapse(uuid, text) from public, anon, authenticated;
revoke execute on function public.licence_notify_admins(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.licence_refresh_targeting(uuid) from public, anon, authenticated;
revoke execute on function public.licence_view(uuid) from public, anon, authenticated;
revoke execute on function public.licence_verified_states(uuid) from public, anon;
revoke execute on function public.licence_allows(uuid, text) from public, anon;
revoke execute on function public.licence_ready(uuid) from public, anon;
revoke execute on function public.my_licence() from public, anon;
revoke execute on function public.licence_review_request(text, text[], text, text) from public, anon;
revoke execute on function public.admin_licence_review_decide(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.licence_verified_states(uuid), public.licence_allows(uuid, text), public.licence_ready(uuid),
  public.my_licence(), public.licence_review_request(text, text[], text, text),
  public.admin_licence_review_decide(uuid, boolean, jsonb, text) to authenticated;
grant execute on function public.licence_verified_states(uuid), public.licence_allows(uuid, text), public.licence_ready(uuid) to service_role;
grant execute on function public.licence_apply_check(uuid, text, text, text, jsonb, boolean), public.licence_daily_sweep(),
  public.licence_view(uuid), public.licence_refresh_targeting(uuid) to service_role;

-- ── 15. Cron: the expiry sweep at 7 AM Central, the NIPR re-check at 6 AM Central ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('licence-daily-sweep', 'nipr-daily-recheck');
    perform cron.schedule('licence-daily-sweep', '0 13 * * *', 'select public.licence_daily_sweep()');
    if to_regprocedure('public.fulfillment_cron_post(text, jsonb)') is not null then
      perform cron.schedule('nipr-daily-recheck', '0 12 * * *',
        $c$select public.fulfillment_cron_post('nipr-check', '{"action":"daily"}'::jsonb)$c$);
    end if;
  end if;
end $$;
