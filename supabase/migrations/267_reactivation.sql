-- 267_reactivation (Prompt 952, Brayden Nov 10 20:30, idea from Nate). NOT APPLIED until Brayden's yes.
--
-- Reactivate old leads: an agent imports an aged-lead list on Leads, we clean it, they tick the responsibility line
-- and pay a flat price per callable lead (one-off charge, OHVARA LEADS), the national Do Not Call + litigator scrub
-- runs, then our AI calls each person (calls only, never texts) from a SEPARATE pool of Deedstone numbers, day 1, 2,
-- 4, 7 and 14, 8 AM-8 PM in their own time zone (and the state's stricter rules). Booked or live-transferred people
-- land on the agent's Leads board tagged Reactivated and count as Delivered. "Stop calling" / "not interested" goes on
-- our do-not-call list for good. A list whose stop rate runs high pauses itself and tells the admins.
-- Rules mirrored in src/lib/reactivation.js. Doc: brain/ohvara/Reactivation.md.
--
-- STAYS OFF: recovery_config.reactivation_live (default false) gates every dial and every live-key charge. Like every
-- live flag since P950, no signed-in user can change it (live_flags_guard); CC turns it on with Brayden's yes.
-- reactivation_settings.scrub_provider is guarded the same way (CC sets it once the scrub account and key exist).
--
-- What this changes in existing code (each redefinition copies the latest body and adds only the reactivation branch):
--   route_new_lead (244)      a reactivation lead never starts speed to lead or the VA desk (the dialer queues its call)
--   ghl_enqueue_lead (260),   nothing about a reactivation lead goes to GoHighLevel: no texts, no workflows (A2P)
--   lead_ghl_event (248)
--   ai_caller_takes (260)     the reactivation rules (flag, list working, window, do-not-call, a reactivation number)
--   ai_caller_to_va (244)     a reactivation call that couldn't start goes back in line, never to a VA
--   ai_caller_result (248)    a reactivation call's result goes to reactivation_after_call: no 2-minute retry, no texts
--   ai_caller_sweep (248)     leaves reactivation calls to reactivation_tick
--   deedstone_assign, deedstone_from, admin_deedstone_numbers, admin_deedstone_number_save (255): the pool column
--   lead_spend_charge_result (260): the 'reactivation' charge kind
-- Tests: supabase/tests/p952_reactivation.sql (PGlite).

do $$ begin
  if to_regclass('public.ai_calls') is null or to_regclass('public.deedstone_numbers') is null
     or to_regclass('public.state_call_rules') is null or to_regprocedure('public.live_flags_guard()') is null then
    raise exception '267 needs 236, 244, 255 and 266 applied first';
  end if;
end $$;

-- ── 1. The live flag ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.recovery_config add column if not exists reactivation_live boolean not null default false;
comment on column public.recovery_config.reactivation_live is
  'P952: reactivation calls (and charges on a live Stripe key) run only while this is on. Off until Ohvara turns it on with Brayden''s yes (no portal switch, P950).';
drop trigger if exists recovery_config_live_guard on public.recovery_config;
create trigger recovery_config_live_guard before update on public.recovery_config
  for each row execute function public.live_flags_guard('sms_live', 'voice_live', 'ai_caller_live', 'owner_payouts_live', 'payouts_live',
                                                        'recording_live', 'invite_sms_live', 'reactivation_live');

-- ── 2. Settings ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.reactivation_settings (
  id                boolean primary key default true check (id),
  price_cents       int not null default 200 check (price_cents between 25 and 2000),
  min_leads         int not null default 100 check (min_leads between 1 and 5000),
  max_attempts      int not null default 5 check (max_attempts between 1 and 5),
  cadence_days      int[] not null default '{0,1,3,6,13}',
  call_start        time not null default '08:00',
  call_end          time not null default '20:00',
  pause_stop_rate   numeric(4,3) not null default 0.050 check (pause_stop_rate between 0.005 and 0.5),
  pause_min_reached int not null default 20 check (pause_min_reached between 5 and 1000),
  scrub_provider    text not null default 'none' check (scrub_provider in ('none', 'blacklist_alliance', 'dnc_com', 'stub')),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null,
  constraint reactivation_settings_window check (call_end > call_start and call_start >= '08:00' and call_end <= '20:00')
);
insert into public.reactivation_settings (id) values (true) on conflict do nothing;
alter table public.reactivation_settings enable row level security;
revoke all on public.reactivation_settings from public, anon, authenticated;
grant select on public.reactivation_settings to authenticated;
drop policy if exists reactivation_settings_admin on public.reactivation_settings;
create policy reactivation_settings_admin on public.reactivation_settings for select to authenticated using (public.is_admin());
drop trigger if exists reactivation_settings_live_guard on public.reactivation_settings;
create trigger reactivation_settings_live_guard before update on public.reactivation_settings
  for each row execute function public.live_flags_guard('scrub_provider');
comment on table public.reactivation_settings is
  'P952: price per callable lead, list minimum, attempts, hours, auto-pause. scrub_provider is set by CC once the scrub account exists (none = lists wait, nothing dials).';

-- ── 3. A separate pool of Deedstone numbers ─────────────────────────────────────────────────────────────────────
alter table public.deedstone_numbers add column if not exists pool text not null default 'main' check (pool in ('main', 'reactivation'));
comment on column public.deedstone_numbers.pool is
  'P952: main = fresh leads, agents and VAs; reactivation = aged-list calls only (spam reports on old lists never touch the main numbers).';

create or replace function public.deedstone_assign(p_agent uuid)
returns public.deedstone_numbers language plpgsql volatile security definer set search_path = public as $$
declare
  n    public.deedstone_numbers;
  lim  int := (select daily_limit from deedstone_settings());
  need int;
  full_ boolean := false;
begin
  if p_agent is null then return null; end if;
  select x.* into n from deedstone_agent_lines l join deedstone_numbers x on x.id = l.number_id
   where l.agent_id = p_agent and x.active and x.pool = 'main';
  if n.id is not null then return n; end if;
  perform pg_advisory_xact_lock(hashtext('deedstone_assign'));
  need := deedstone_agent_load(p_agent);
  select x.* into n from deedstone_numbers x
   where x.active and x.pool = 'main' and deedstone_number_load(x.id) + need <= lim
   order by x.sort, x.created_at limit 1;
  if n.id is null then
    full_ := true;
    select x.* into n from deedstone_numbers x where x.active and x.pool = 'main'
     order by deedstone_number_load(x.id), x.sort, x.created_at limit 1;
  end if;
  if n.id is null then return null; end if;
  insert into deedstone_agent_lines (agent_id, number_id, assigned_at) values (p_agent, n.id, now())
  on conflict (agent_id) do update set number_id = excluded.number_id, assigned_at = now(), updated_at = now();
  if full_ then
    perform route_notify_admins('deedstone_number_hot', 'Every Deedstone number is full',
      'A new agent was put on ' || n.phone || '. Add a Deedstone number in Settings.', '/admin/settings?tab=numbers',
      'deedstone_full:' || deedstone_day(now())::text);
  end if;
  return n;
end;
$$;

-- The reactivation number for one call: the active reactivation number with the fewest calls today. Null = none.
create or replace function public.reactivation_number()
returns public.deedstone_numbers language sql stable security definer set search_path = public as $$
  select x.* from deedstone_numbers x where x.active and x.pool = 'reactivation'
   order by deedstone_today(x.id), x.sort, x.created_at limit 1
$$;
revoke execute on function public.reactivation_number() from public, anon, authenticated;

-- P916's caller ID, plus: a reactivation call (p_ref = its ai_calls id) uses the reactivation pool and NEVER falls
-- back to a main number ({ phone: null, pool: 'reactivation' } when the pool is empty: the call doesn't start).
create or replace function public.deedstone_from(p_agent uuid, p_kind text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare n public.deedstone_numbers; today int; lim int := (select daily_limit from deedstone_settings()); re boolean := false;
begin
  if p_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    re := exists (select 1 from ai_calls c where c.id = p_ref::uuid and c.reactivation_contact_id is not null);
  end if;
  if re then
    n := reactivation_number();
    if n.id is null then return jsonb_build_object('phone', null, 'pool', 'reactivation'); end if;
    if p_kind is not null then
      insert into deedstone_number_use (number_id, kind, agent_id, ref) values (n.id, p_kind, p_agent, left(p_ref, 120));
      today := deedstone_today(n.id);
      if today >= ceil(lim * 0.9) then
        perform route_notify_admins('deedstone_number_hot', 'A reactivation number is running hot',
          n.phone || ' has placed ' || today || ' reactivation calls today (limit ' || lim || '). Add a reactivation number in Settings.',
          '/admin/settings?tab=numbers', 'deedstone_hot:' || n.id::text || ':' || deedstone_day(now())::text);
      end if;
    end if;
    return jsonb_build_object('phone', n.phone, 'provider_number_id', n.provider_number_id, 'number_id', n.id, 'pool', 'reactivation');
  end if;
  if p_agent is null then return null; end if;
  n := deedstone_assign(p_agent);
  if n.id is null then return null; end if;
  if p_kind is not null then
    insert into deedstone_number_use (number_id, kind, agent_id, ref) values (n.id, p_kind, p_agent, left(p_ref, 120));
    today := deedstone_today(n.id);
    if today >= ceil(lim * 0.9) then
      perform route_notify_admins('deedstone_number_hot', 'A Deedstone number is running hot',
        n.phone || ' has placed ' || today || ' calls today (limit ' || lim || '). Add a number in Settings.',
        '/admin/settings?tab=numbers', 'deedstone_hot:' || n.id::text || ':' || deedstone_day(now())::text);
    end if;
  end if;
  return jsonb_build_object('phone', n.phone, 'provider_number_id', n.provider_number_id, 'number_id', n.id, 'pool', 'main');
end;
$$;

create or replace function public.admin_deedstone_numbers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; out_ jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into s from deedstone_settings();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'phone', x.phone, 'label', x.label, 'caller_name', x.caller_name, 'active', x.active,
           'provider_number_id', x.provider_number_id, 'pool', x.pool,
           'agents', (select count(*) from deedstone_agent_lines l where l.number_id = x.id),
           'load', deedstone_number_load(x.id),
           'today', deedstone_today(x.id),
           'days', (select jsonb_agg(jsonb_build_object('day', d::date, 'calls',
                      (select count(*) from deedstone_number_use u where u.number_id = x.id and u.at > now() - interval '8 days'
                          and deedstone_day(u.at) = d::date)) order by d)
                      from generate_series((deedstone_day(now()) - 6)::timestamp, deedstone_day(now())::timestamp, interval '1 day') d),
           'hot', deedstone_today(x.id) >= ceil(s.daily_limit * 0.9),
           'full', x.pool = 'main' and deedstone_number_load(x.id) + s.agent_estimate > s.daily_limit
         ) order by x.pool, x.sort, x.created_at), '[]'::jsonb)
    into out_ from deedstone_numbers x;
  return jsonb_build_object('limit', s.daily_limit, 'estimate', s.agent_estimate, 'numbers', out_,
    'add_number', not exists (select 1 from jsonb_array_elements(out_) n
                               where n ->> 'pool' = 'main' and (n ->> 'active')::boolean and not (n ->> 'hot')::boolean and not (n ->> 'full')::boolean),
    'reactivation_numbers', (select count(*) from deedstone_numbers where active and pool = 'reactivation'),
    'agents_without_phone', (select count(*) from profiles p left join deedstone_agent_lines l on l.agent_id = p.id
                              where p.role::text = 'agent' and coalesce(p.is_active, true) and not coalesce(p.is_demo, false)
                                and l.call_phone is null));
end;
$$;

-- Same as 255 plus the pool. A number's pool can't change while agents sit on it (their clients know that number).
drop function if exists public.admin_deedstone_number_save(uuid, text, text, text, text, boolean);
create or replace function public.admin_deedstone_number_save(p_id uuid, p_phone text, p_label text default null,
  p_caller_name text default null, p_provider_number_id text default null, p_active boolean default true, p_pool text default null)
returns public.deedstone_numbers language plpgsql volatile security definer set search_path = public as $$
declare n deedstone_numbers; e text := sms_e164(p_phone);
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if e is null then raise exception 'Enter a 10-digit US number' using errcode = '22023'; end if;
  if p_pool is not null and p_pool not in ('main', 'reactivation') then raise exception 'Pick main or reactivation' using errcode = '22023'; end if;
  if p_id is null then
    insert into deedstone_numbers (phone, label, caller_name, provider_number_id, active, sort, created_by, pool)
    values (e, nullif(trim(p_label), ''), coalesce(nullif(upper(trim(p_caller_name)), ''), 'DEEDSTONE INS'),
            nullif(trim(p_provider_number_id), ''), coalesce(p_active, true),
            coalesce((select max(sort) + 1 from deedstone_numbers), 0), auth.uid(), coalesce(p_pool, 'main'))
    returning * into n;
  else
    if p_pool is not null and p_pool <> (select pool from deedstone_numbers where id = p_id)
       and exists (select 1 from deedstone_agent_lines where number_id = p_id) then
      raise exception 'Agents are on this number. Add a new number for reactivation instead.' using errcode = '22023';
    end if;
    update deedstone_numbers
       set phone = e, label = nullif(trim(p_label), ''),
           caller_name = coalesce(nullif(upper(trim(p_caller_name)), ''), caller_name),
           provider_number_id = nullif(trim(p_provider_number_id), ''), active = coalesce(p_active, active),
           pool = coalesce(p_pool, pool), updated_at = now()
     where id = p_id returning * into n;
    if n.id is null then raise exception 'Number not found' using errcode = 'P0002'; end if;
  end if;
  return n;
end;
$$;
revoke execute on function public.admin_deedstone_number_save(uuid, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_deedstone_number_save(uuid, text, text, text, text, boolean, text) to authenticated;

-- ── 4. Lists and the people on them ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reactivation_lists (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  status           text not null default 'draft' check (status in
                     ('draft', 'waiting_payment', 'payment_failed', 'waiting_scrub', 'working', 'paused', 'done', 'cancelled')),
  uploaded         int not null default 0 check (uploaded >= 0),
  removed          jsonb not null default '{}'::jsonb,       -- { bad_number, duplicate, existing, unlicensed, dnc, national_dnc, litigator }
  callable         int not null default 0 check (callable >= 0),
  price_cents_each int not null check (price_cents_each > 0),
  amount_cents     int not null default 0 check (amount_cents >= 0),
  attest_text      text not null,
  attest_version   text not null,
  attested_at      timestamptz not null,
  charge_id        uuid references public.lead_spend_charges(id) on delete set null,
  paid_at          timestamptz,
  scrub_provider   text,
  scrubbed_at      timestamptz,
  refund_due_cents int not null default 0 check (refund_due_cents >= 0),
  refunded_cents   int not null default 0 check (refunded_cents >= 0),
  started_at       timestamptz,
  paused_at        timestamptz,
  pause_reason     text check (char_length(pause_reason) <= 300),
  done_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reactivation_lists_agent_idx on public.reactivation_lists (agent_id, created_at desc);
alter table public.reactivation_lists enable row level security;
revoke all on public.reactivation_lists from public, anon, authenticated;
grant select on public.reactivation_lists to authenticated;
drop policy if exists reactivation_lists_read on public.reactivation_lists;
create policy reactivation_lists_read on public.reactivation_lists for select to authenticated using (agent_id = auth.uid() or public.is_admin());

create table if not exists public.reactivation_contacts (
  id             uuid primary key default gen_random_uuid(),
  list_id        uuid not null references public.reactivation_lists(id) on delete cascade,
  agent_id       uuid not null references public.profiles(id) on delete cascade,
  first_name     text check (char_length(first_name) <= 60),
  last_name      text check (char_length(last_name) <= 60),
  phone          text not null check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  state          text not null check (state ~ '^[A-Z]{2}$'),
  age            int check (age between 18 and 110),
  mortgage_cents bigint check (mortgage_cents > 0),
  lead_date      text check (char_length(lead_date) <= 40),
  source         text check (char_length(source) <= 80),
  status         text not null default 'waiting_scrub' check (status in ('waiting_scrub', 'queued', 'calling', 'booked', 'transferred',
                   'not_now', 'not_interested', 'stop', 'wrong_number', 'no_answer', 'removed')),
  removed_reason text check (removed_reason in ('national_dnc', 'litigator', 'dnc', 'list_cancelled')),
  attempts       int not null default 0 check (attempts between 0 and 10),
  next_at        timestamptz,
  last_called_at timestamptz,
  last_outcome   text,
  reached        boolean not null default false,
  voicemail_left boolean not null default false,
  lead_id        uuid references public.leads(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (list_id, phone)
);
create index if not exists reactivation_contacts_due_idx on public.reactivation_contacts (next_at) where status = 'queued';
create index if not exists reactivation_contacts_list_idx on public.reactivation_contacts (list_id, status);
create index if not exists reactivation_contacts_phone_idx on public.reactivation_contacts (phone);
alter table public.reactivation_contacts enable row level security;
revoke all on public.reactivation_contacts from public, anon, authenticated;
grant select on public.reactivation_contacts to authenticated;
drop policy if exists reactivation_contacts_admin on public.reactivation_contacts;
create policy reactivation_contacts_admin on public.reactivation_contacts for select to authenticated using (public.is_admin());

-- ── 5. Leads and AI calls know about reactivation ───────────────────────────────────────────────────────────────
alter table public.leads add column if not exists reactivation_id uuid references public.reactivation_contacts(id) on delete set null;
alter table public.leads add column if not exists reactivated_at timestamptz;
comment on column public.leads.reactivation_id is
  'P952: this lead is a person on an agent''s reactivation list. Hidden from everyone signed in until reactivated_at (booked or live transfer).';
create index if not exists leads_reactivation_idx on public.leads (reactivation_id) where reactivation_id is not null;
-- Nobody signed in sees a reactivation person until they're delivered (booked or live-transferred): the agent's board,
-- counts and charts (agent_inbounds is security invoker) and the admin's lead reads all go through this.
drop policy if exists leads_reactivation_hidden on public.leads;
create policy leads_reactivation_hidden on public.leads as restrictive for select to authenticated
  using (reactivation_id is null or reactivated_at is not null);

alter table public.ai_calls add column if not exists reactivation_contact_id uuid references public.reactivation_contacts(id) on delete set null;
alter table public.ai_calls drop constraint if exists ai_calls_attempt_check;
alter table public.ai_calls add constraint ai_calls_attempt_check check (attempt between 1 and 10);
create index if not exists ai_calls_reactivation_idx on public.ai_calls (reactivation_contact_id) where reactivation_contact_id is not null;

-- ── 6. The existing paths, with the reactivation branch ─────────────────────────────────────────────────────────
create or replace function public.route_new_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; cid uuid;
begin
  if new.lead_type is distinct from 'cancellation' and new.phone is not null and new.reactivation_id is null then -- P952
    begin
      select * into w from public.ai_caller_takes(new.id);
      if w.by = 'ai' then
        insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, provider)
        values (new.id, new.assigned_rep_id, 1, coalesce(new.created_at, now()), (select provider from public.ai_caller_settings where id))
        on conflict do nothing returning id into cid;
        if cid is not null then
          perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', cid));
          return new;
        end if;
      end if;
      perform public.route_enqueue('new_lead', new.id);
    exception when others then
      raise warning 'route_new_lead %: %', new.id, sqlerrm;  -- never blocks the lead
      begin perform public.route_enqueue('new_lead', new.id); exception when others then null; end;
    end;
  end if;
  return new;
end;
$$;

create or replace function public.ghl_enqueue_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inbound_stage is null or coalesce(new.is_sample, false) or not public.ghl_enabled()
     or public.profile_is_test(new.assigned_rep_id)               -- P929
     or new.reactivation_id is not null then                     -- P952: calls only, nothing to GoHighLevel
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into ghl_outbox (event, lead_id, stage) values ('new_inbound', new.id, new.inbound_stage);
  elsif new.inbound_stage is distinct from old.inbound_stage then
    insert into ghl_outbox (event, lead_id, stage)
    values (case when new.inbound_stage = 'booked' then 'appointment_reminder' else 'stage' end,
            new.id, new.inbound_stage);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_lead: %', sqlerrm;   -- never block the lead write
  return new;
end;
$$;

create or replace function public.lead_ghl_event(p_event text, p_lead uuid, p_detail jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ghl_enabled() or exists (select 1 from public.leads where id = p_lead
                                          and (coalesce(is_sample, false) or reactivation_id is not null)) then return; end if; -- P952
  insert into public.ghl_outbox (event, lead_id, detail) values (p_event, p_lead, coalesce(p_detail, '{}'::jsonb));
exception when others then raise warning 'lead_ghl_event %: %', p_event, sqlerrm;
end;
$$;
revoke execute on function public.lead_ghl_event(text, uuid, jsonb) from public, anon, authenticated;

-- ── 7. Calling hours ────────────────────────────────────────────────────────────────────────────────────────────
-- Open when the state's own rule is open (P882: FL, OK, MD 8-8 with 3 tries a day, TX 9-9 and Sunday noon, …) AND
-- it's inside 8 AM-8 PM in every zone of the state (reactivation_settings). Unknown state = never.
create or replace function public.reactivation_window_ok(p_state text, p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r state_call_rules; s reactivation_settings; z text; lt time;
begin
  select * into r from state_call_rules where state = upper(trim(coalesce(p_state, '')));
  if r.state is null then return false; end if;
  select * into s from reactivation_settings where id;
  if not call_window_ok(r, p_at) then return false; end if;
  foreach z in array r.tz loop
    lt := (p_at at time zone z)::time;
    if lt < s.call_start or lt >= s.call_end then return false; end if;
  end loop;
  return true;
end;
$$;

-- The first open moment at or after p_at (null for an unknown state).
create or replace function public.reactivation_window_next(p_state text, p_at timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare r state_call_rules; s reactivation_settings; z text; d int; day date; st time; c timestamptz; best timestamptz;
begin
  if reactivation_window_ok(p_state, p_at) then return p_at; end if;
  select * into r from state_call_rules where state = upper(trim(coalesce(p_state, '')));
  if r.state is null then return null; end if;
  select * into s from reactivation_settings where id;
  foreach z in array r.tz loop
    for d in 0..7 loop
      day := (p_at at time zone z)::date + d;
      st := greatest(s.call_start, case when extract(dow from day) = 0 and r.sun_start is not null then r.sun_start else r.call_start end);
      c := (day + st) at time zone z;
      if c >= p_at and reactivation_window_ok(p_state, c) and (best is null or c < best) then best := c; end if;
    end loop;
  end loop;
  return best;
end;
$$;
revoke execute on function public.reactivation_window_ok(text, timestamptz), public.reactivation_window_next(text, timestamptz) from public, anon;

-- When attempt k is due for a list that started at p_start (cadence_days; past the last attempt → null).
create or replace function public.reactivation_due(p_start timestamptz, p_k int)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case when p_k between 1 and least(s.max_attempts, cardinality(s.cadence_days))
              then p_start + make_interval(days => s.cadence_days[p_k]) end
    from reactivation_settings s where s.id
$$;
revoke execute on function public.reactivation_due(timestamptz, int) from public, anon;

-- ── 8. The AI caller's rules, with reactivation ─────────────────────────────────────────────────────────────────
create or replace function public.ai_caller_takes(p_lead uuid)
returns table(by text, reason text) language plpgsql stable security definer set search_path = public as $$
declare l public.leads; s public.ai_caller_settings; chk record; rc public.reactivation_contacts; rl public.reactivation_lists; d public.dnc_numbers;
begin
  select * into l from public.leads where id = p_lead;
  -- P952: a person on a reactivation list. Consent is the agent's tick on the list; the rules are reactivation's own.
  if l.reactivation_id is not null then
    select * into rc from public.reactivation_contacts where id = l.reactivation_id;
    select * into rl from public.reactivation_lists where id = rc.list_id;
    if public.profile_is_test(l.assigned_rep_id) then return query select 'va', 'test_account'; return; end if;
    if not coalesce((select reactivation_live from public.recovery_config limit 1), false) then
      return query select 'va', 'switch_off'; return;
    end if;
    if rl.status is distinct from 'working' then return query select 'va', 'list_' || coalesce(rl.status, 'missing'); return; end if;
    if rc.status not in ('queued', 'calling') then return query select 'va', 'contact_done'; return; end if;
    select * into d from public.dnc_numbers where phone = rc.phone;
    if public.sms_is_opted_out(rc.phone) or coalesce(d.internal, false) or coalesce(d.national, false) then
      return query select 'va', 'dnc'; return;
    end if;
    if not public.reactivation_window_ok(rc.state, now()) then return query select 'va', 'outside_hours'; return; end if;
    if (public.reactivation_number()).id is null then return query select 'va', 'no_reactivation_number'; return; end if;
    return query select 'ai', null::text; return;
  end if;
  if l.id is null or l.lead_type is distinct from 'mortgage_protection' or l.phone is null
     or coalesce(l.qualifier_answers ->> 'consent_at', '') = '' or l.call_consent_at is not null then
    return query select 'va', 'not_form'; return;               -- inbound calls and anything not a fresh form lead
  end if;
  if public.profile_is_test(l.assigned_rep_id) then
    return query select 'va', 'test_account'; return;           -- P929: the sandbox never reaches Retell
  end if;
  if not coalesce((select ai_caller_live from public.recovery_config limit 1), false) then
    return query select 'va', 'switch_off'; return;
  end if;
  select * into s from public.ai_caller_settings where id;
  if l.assigned_rep_id is null or not (s.all_agents or l.assigned_rep_id = any(s.agent_ids)) then
    return query select 'va', 'agent_not_on'; return;
  end if;
  if not public.lead_ai_consent_ok(p_lead) then return query select 'va', 'no_ai_consent'; return; end if;
  select * into chk from public.predial_eval(l.phone, l.state, l.id, 'call', now(), null, false);
  if not chk.ok then return query select 'va', coalesce(chk.reason, 'predial'); return; end if;
  return query select 'ai', null::text;
end;
$$;

-- A reactivation call that couldn't start: back in line (outside hours → the next open moment; do-not-call → off the
-- list; anything else → 30 minutes). No attempt is counted and nothing ever goes to a VA.
create or replace function public.reactivation_not_dialed(p_contact uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare rc reactivation_contacts;
begin
  select * into rc from reactivation_contacts where id = p_contact for update;
  if rc.id is null or rc.status not in ('queued', 'calling') then return; end if;
  if p_reason = 'dnc' then
    update reactivation_contacts set status = 'removed', removed_reason = 'dnc', next_at = null, updated_at = now() where id = rc.id;
  else
    update reactivation_contacts set status = 'queued', updated_at = now(),
           next_at = case when p_reason = 'outside_hours' then coalesce(reactivation_window_next(rc.state, now()), now() + interval '1 day')
                          else now() + interval '30 minutes' end
     where id = rc.id;
  end if;
end;
$$;
revoke execute on function public.reactivation_not_dialed(uuid, text) from public, anon, authenticated;

create or replace function public.ai_caller_to_va(p_call uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.ai_calls;
begin
  update public.ai_calls set status = 'to_va', to_va_reason = left(p_reason, 120), updated_at = now()
   where id = p_call and status in ('queued', 'dialing') returning * into c;
  if c.id is null then return null; end if;
  if c.reactivation_contact_id is not null then                 -- P952: never a VA; back in line
    perform public.reactivation_not_dialed(c.reactivation_contact_id, p_reason);
    return null;
  end if;
  return public.route_enqueue('new_lead', c.lead_id, p_detail => jsonb_build_object('from_ai', true, 'ai_call_id', c.id, 'why', p_reason));
end;
$$;

-- ── 9. After a reactivation call ────────────────────────────────────────────────────────────────────────────────
create or replace function public.reactivation_after_call(p_call uuid, p_outcome text, p_callback_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c   ai_calls; rc reactivation_contacts; rl reactivation_lists; s reactivation_settings;
  max_ int; nxt timestamptz; st text; vm boolean;
begin
  select * into c from ai_calls where id = p_call;
  select * into rc from reactivation_contacts where id = c.reactivation_contact_id for update;
  if rc.id is null then return jsonb_build_object('ok', false, 'code', 'no_contact'); end if;
  select * into rl from reactivation_lists where id = rc.list_id;
  select * into s from reactivation_settings where id;
  max_ := least(s.max_attempts, cardinality(s.cadence_days));
  vm := p_outcome = 'no_answer' and coalesce(c.summary, '') ilike '%voicemail%';

  st := case p_outcome
          when 'booked' then 'booked' when 'transferred' then 'transferred'
          when 'hard_no' then 'not_interested' when 'opt_out' then 'stop' when 'wrong_number' then 'wrong_number'
          when 'not_now' then case when c.attempt >= max_ then 'not_now' else 'queued' end
          else case when c.attempt >= max_ then 'no_answer' else 'queued' end end;
  if st = 'queued' then
    nxt := case when p_outcome = 'not_now' and p_callback_at is not null and p_callback_at > now() then p_callback_at
                else greatest(now() + interval '12 hours', reactivation_due(coalesce(rl.started_at, rc.created_at), c.attempt + 1)) end;
    nxt := coalesce(reactivation_window_next(rc.state, nxt), nxt);
  end if;

  update reactivation_contacts set status = st, attempts = greatest(attempts, c.attempt), last_called_at = now(), last_outcome = p_outcome,
         reached = reached or p_outcome in ('booked', 'transferred', 'not_now', 'hard_no', 'opt_out'),
         voicemail_left = voicemail_left or vm, next_at = case when st = 'queued' then nxt end, updated_at = now()
   where id = rc.id;

  if p_outcome in ('booked', 'transferred') then
    -- Delivered: on the agent's Leads board, tagged Reactivated (qualifier_answers.reactivation), counted as Delivered.
    update leads set reactivated_at = coalesce(reactivated_at, now()), delivered_at = coalesce(delivered_at, now()),
           first_call_outcome = coalesce(first_call_outcome, p_outcome), first_call_at = coalesce(first_call_at, now()),
           first_call_by = coalesce(first_call_by, 'ai'),
           inbound_stage = case when p_outcome = 'booked' then 'booked' else inbound_stage end
     where id = c.lead_id;
  elsif p_outcome in ('hard_no', 'opt_out') then
    -- "Stop calling" and "not interested": our do-not-call list, for good.
    insert into dnc_numbers (phone, internal, source, note) values (rc.phone, true, 'reactivation',
           case when p_outcome = 'opt_out' then 'Asked not to be called (reactivation)' else 'Not interested (reactivation)' end)
    on conflict (phone) do update set internal = true, source = coalesce(dnc_numbers.source, 'reactivation');
    update leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_at = now(),
           outcome_reason = case when p_outcome = 'opt_out' then 'Asked not to be called' else 'Not interested' end
     where id = c.lead_id;
  end if;

  perform reactivation_list_check(rl.id);
  return jsonb_build_object('ok', true, 'status', st, 'next_at', nxt);
end;
$$;
revoke execute on function public.reactivation_after_call(uuid, text, timestamptz) from public, anon, authenticated;

-- Progress for one list (src/lib/reactivation.js listProgress / listQuality).
create or replace function public.reactivation_progress(p_list uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*) filter (where status <> 'removed'),
    'worked', count(*) filter (where attempts > 0),
    'reached', count(*) filter (where reached),
    'booked', count(*) filter (where status = 'booked'),
    'transferred', count(*) filter (where status = 'transferred'),
    'stop', count(*) filter (where status = 'stop'),
    'not_interested', count(*) filter (where status = 'not_interested'),
    'wrong', count(*) filter (where status = 'wrong_number'),
    'remaining', count(*) filter (where status in ('queued', 'calling', 'waiting_scrub')),
    'removed', count(*) filter (where status = 'removed'))
  from reactivation_contacts where list_id = p_list
$$;
revoke execute on function public.reactivation_progress(uuid) from public, anon, authenticated;

-- After each result: pause a list whose stop rate is over the limit (an admin to-do + a bell), finish an empty one.
create or replace function public.reactivation_list_check(p_list uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p jsonb := reactivation_progress(p_list); s reactivation_settings; rl reactivation_lists; reached int; stops int; rate numeric;
begin
  select * into rl from reactivation_lists where id = p_list for update;
  if rl.status <> 'working' then return rl.status; end if;
  select * into s from reactivation_settings where id;
  reached := (p ->> 'reached')::int; stops := (p ->> 'stop')::int;
  rate := case when reached > 0 then stops::numeric / reached else 0 end;
  if reached >= s.pause_min_reached and rate > s.pause_stop_rate then
    update reactivation_lists set status = 'paused', paused_at = now(), updated_at = now(),
           pause_reason = left(stops || ' of ' || reached || ' people reached asked us to stop calling (' || round(rate * 100) || '%, limit '
                               || round(s.pause_stop_rate * 100, 1) || '%)', 300)
     where id = p_list;
    perform route_notify_admins('reactivation_paused', 'A reactivation list paused itself',
      coalesce((select full_name from profiles where id = rl.agent_id), 'An agent') || '''s list "' || rl.name || '": ' || stops || ' of '
        || reached || ' reached asked us to stop. Check it in Leads › Reactivation.', '/admin/inbounds?view=reactivation',
      'reactivation_paused:' || p_list::text);
    return 'paused';
  end if;
  if (p ->> 'remaining')::int = 0 then
    update reactivation_lists set status = 'done', done_at = now(), updated_at = now() where id = p_list;
    return 'done';
  end if;
  return 'working';
end;
$$;
revoke execute on function public.reactivation_list_check(uuid) from public, anon, authenticated;

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select 'reactivation_paused', array['admin'], 'A reactivation list paused itself (too many stop requests)', false, null, true, true,
       false, true, coalesce((select max(sort) from public.notification_types), 0) + 1
 where not exists (select 1 from public.notification_types where type = 'reactivation_paused');

-- 248's result, with the reactivation branch first: no 2-minute retry, no first-call flow, no texts.
create or replace function public.ai_caller_result(p_call uuid, p_outcome text, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; nxt uuid; secs int; label text; ag uuid; cb timestamptz; fc jsonb;
begin
  if p_outcome not in ('no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  cb := case when p_outcome = 'not_now' then nullif(p_patch ->> 'callback_at', '')::timestamptz end;
  update public.ai_calls set status = 'done', outcome = p_outcome, ended_at = now(),
    duration_secs  = coalesce((p_patch ->> 'duration_secs')::int, duration_secs),
    cost_cents     = coalesce((p_patch ->> 'cost_cents')::numeric,
                       ceil(coalesce((p_patch ->> 'duration_secs')::int, 0) / 60.0) * (select cents_per_min from public.ai_caller_settings where id)),
    booked_for     = coalesce((p_patch ->> 'booked_for')::timestamptz, booked_for),
    callback_at    = coalesce(cb, callback_at),
    summary        = coalesce(left(p_patch ->> 'summary', 1200), summary),
    transcript_ref = coalesce(p_patch ->> 'transcript_ref', transcript_ref),
    updated_at     = now()
   where id = p_call and status <> 'done' returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'gone'); end if;

  if c.reactivation_contact_id is not null then                   -- P952
    label := 'Reactivation call ' || c.attempt || '. ' ||
             case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                            when 'not_now' then 'Reached them. Not a good time' when 'hard_no' then 'Reached them. Not interested'
                            when 'wrong_number' then 'Wrong number' when 'no_answer' then 'No answer' when 'opt_out' then 'Asked not to be called' end;
    insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
    values (c.lead_id, c.agent_id, 'va_call', label, jsonb_build_object('result', p_outcome, 'try', c.attempt, 'reactivation', true), 'Our team', 'team');
    return public.reactivation_after_call(c.id, p_outcome, cb) || jsonb_build_object('label', label);
  end if;

  -- Speed is from the lead arriving to the FIRST dial (attempt 1). Agent-safe words (rules.js agentLine), never "AI".
  select round(secs_to_dial) into secs from public.ai_calls where lead_id = c.lead_id and attempt = 1;
  label := 'Called' || case when secs is null then '' else ' in ' || secs || ' second' || case when secs = 1 then '' else 's' end end || '. ' ||
           case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                          when 'not_now' then case when cb is not null then 'Reached them. Booked a callback' else 'Reached them. Not a good time' end
                          when 'hard_no' then 'Reached them. Not interested' when 'wrong_number' then 'Wrong number'
                          when 'no_answer' then 'No answer' when 'opt_out' then 'Asked not to be called' end;
  select assigned_rep_id into ag from public.leads where id = c.lead_id;
  insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, ag, 'va_call', label, jsonb_build_object('speed_secs', secs, 'result', p_outcome, 'try', c.attempt), 'Our team', 'team');

  if p_outcome = 'no_answer' and c.attempt = 1 then
    -- One more try 2 minutes later; the outcome waits for it.
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider)
    values (c.lead_id, c.agent_id, 2, c.lead_in_at, now() + interval '2 minutes', c.provider)
    on conflict do nothing returning id into nxt;
    if nxt is not null then return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label); end if;
  end if;
  fc := public.lead_first_call_outcome(c.lead_id, p_outcome, 'ai', cb);
  return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label, 'first_call', fc);
end;
$$;
revoke execute on function public.ai_caller_result(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.ai_caller_result(uuid, text, jsonb) to service_role;

-- 248's sweep, leaving reactivation calls alone (reactivation_tick handles them).
create or replace function public.ai_caller_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; started int := 0; to_va int := 0; na int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_caller_sweep')) then return jsonb_build_object('skipped', true); end if;
  for r in select c.* from public.ai_calls c where c.status = 'queued' and c.attempt = 2 and c.due_at <= now() and c.updated_at < now() - interval '5 seconds'
             and c.reactivation_contact_id is null loop
    if (select by from public.ai_caller_takes(r.lead_id)) = 'ai' then
      update public.ai_calls set updated_at = now() where id = r.id;
      perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', r.id)); started := started + 1;
    else
      perform public.ai_caller_result(r.id, 'no_answer', jsonb_build_object('summary', 'retry_blocked')); na := na + 1;
    end if;
  end loop;
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.attempt = 1 and c.created_at < now() - interval '20 seconds'
             and c.reactivation_contact_id is null loop
    perform public.ai_caller_to_va(r.id, 'not_started'); to_va := to_va + 1;
  end loop;
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.attempt = 2 and c.due_at < now() - interval '60 seconds'
             and c.reactivation_contact_id is null loop
    perform public.ai_caller_result(r.id, 'no_answer', jsonb_build_object('summary', 'not_started')); na := na + 1;
  end loop;
  return jsonb_build_object('started', started, 'to_va', to_va, 'no_answer', na);
end;
$$;
revoke execute on function public.ai_caller_sweep() from public, anon, authenticated;

-- ── 10. The dialer (pg_cron, every minute) ──────────────────────────────────────────────────────────────────────
-- Off → nothing. On → up to 30 people due now on working lists: outside their hours → the next open moment; else a
-- hidden lead row (first time), an ai_calls row (attempt = tries so far + 1) and the AI caller's start.
create or replace function public.reactivation_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; lid uuid; cid uuid; started int := 0; later int := 0; stale int := 0; rl reactivation_lists;
begin
  if not coalesce((select reactivation_live from recovery_config limit 1), false) then return jsonb_build_object('off', true); end if;
  if not pg_try_advisory_xact_lock(hashtext('reactivation_tick')) then return jsonb_build_object('skipped', true); end if;
  -- A call that never started in 2 minutes goes back in line.
  for r in select c.id from ai_calls c where c.reactivation_contact_id is not null and c.status = 'queued' and c.created_at < now() - interval '2 minutes' loop
    perform ai_caller_to_va(r.id, 'not_started'); stale := stale + 1;
  end loop;
  -- Someone stuck on 'calling' with no live call for 30 minutes goes back in line too.
  update reactivation_contacts rc set status = 'queued', next_at = now(), updated_at = now()
   where rc.status = 'calling' and rc.updated_at < now() - interval '30 minutes'
     and not exists (select 1 from ai_calls c where c.reactivation_contact_id = rc.id and c.status not in ('done', 'to_va'));

  for r in select rc.* from reactivation_contacts rc join reactivation_lists l on l.id = rc.list_id
            where rc.status = 'queued' and rc.next_at <= now() and l.status = 'working'
              and not public.profile_is_test(rc.agent_id)
            order by rc.next_at limit 30 for update of rc skip locked loop
    if not reactivation_window_ok(r.state, now()) then
      update reactivation_contacts set next_at = coalesce(reactivation_window_next(r.state, now()), now() + interval '1 day'), updated_at = now() where id = r.id;
      later := later + 1; continue;
    end if;
    select * into rl from reactivation_lists where id = r.list_id;
    lid := r.lead_id;
    if lid is null then
      insert into leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id, inbound_stage, reactivation_id, qualifier_answers)
      values ('Reactivation', nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), r.phone, r.state,
              'mortgage_protection', r.agent_id, 'contacting', r.id,
              jsonb_strip_nulls(jsonb_build_object('reactivation', true, 'reactivation_list', r.list_id, 'consent_at', rl.attested_at,
                'consent_source', 'agent_attested', 'consent_text_version', rl.attest_version, 'age', r.age,
                'mortgage_balance_cents', r.mortgage_cents, 'lead_date', r.lead_date, 'source', r.source)))
      returning id into lid;
      update reactivation_contacts set lead_id = lid where id = r.id;
    end if;
    insert into ai_calls (lead_id, agent_id, attempt, lead_in_at, provider, reactivation_contact_id)
    values (lid, r.agent_id, least(r.attempts + 1, 10), now(), (select provider from ai_caller_settings where id), r.id)
    on conflict do nothing returning id into cid;
    if cid is null then
      update reactivation_contacts set next_at = now() + interval '30 minutes', updated_at = now() where id = r.id; continue;
    end if;
    update reactivation_contacts set status = 'calling', updated_at = now() where id = r.id;
    perform ai_caller_post(jsonb_build_object('action', 'start', 'call_id', cid));
    started := started + 1;
  end loop;
  return jsonb_build_object('started', started, 'later', later, 'stale', stale);
end;
$$;
revoke execute on function public.reactivation_tick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reactivation-tick', '* * * * *', 'select public.reactivation_tick()');
  end if;
exception when others then raise warning 'reactivation-tick schedule: %', sqlerrm;
end $$;

-- ── 11. The agent's side ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reactivation_phone(p text) returns text language sql immutable set search_path = public as $$
  select case when d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' and d !~ '^([0-9])\1{9}$' and substr(d, 2, 2) <> '11'
                   and not (substr(d, 4, 3) = '555' and substr(d, 7, 2) = '01') then '+1' || d end
    from (select case when length(x) = 11 and left(x, 1) = '1' then substr(x, 2) else x end as d
            from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x) a) b
$$;
revoke execute on function public.reactivation_phone(text) from public, anon;

-- What the import shows before paying: price, minimum, states, and whether calling can start yet.
create or replace function public.reactivation_terms()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s reactivation_settings; me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from reactivation_settings where id;
  return jsonb_build_object('price_cents', s.price_cents, 'min_leads', s.min_leads, 'max_attempts', s.max_attempts,
    'cadence_days', to_jsonb(s.cadence_days), 'live', coalesce((select reactivation_live from recovery_config limit 1), false),
    'scrub_connected', s.scrub_provider <> 'none',
    'licensed', to_jsonb(coalesce((select coalesce(licensed_states, states) from agent_lead_settings where agent_id = me), '{}'::text[])));
end;
$$;
revoke execute on function public.reactivation_terms() from public, anon;
grant execute on function public.reactivation_terms() to authenticated;

-- Make a list from the agent's mapped rows ([{ first, last, phone, state, age, mortgage_cents, lead_date, source }]).
-- The cleaning is repeated here and this is the count that's charged: bad numbers, duplicates, already their leads or
-- clients, states they aren't licensed in, our do-not-call list (internal, opted out, already known national DNC).
create or replace function public.reactivation_create(p_name text, p_rows jsonb, p_attest boolean, p_attest_version text default 'p952-v1')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid(); s reactivation_settings; lic text[]; lid uuid; x jsonb; ph text; st text;
  seen text[] := '{}'; rm jsonb := jsonb_build_object('bad_number', 0, 'duplicate', 0, 'existing', 0, 'unlicensed', 0, 'dnc', 0);
  kept int := 0; why text; d dnc_numbers;
begin
  if me is null or (select role::text from profiles where id = me) is distinct from 'agent' then
    raise exception 'Agents only' using errcode = '42501';
  end if;
  if not coalesce(p_attest, false) then raise exception 'Tick the line about the list first' using hint = 'attest'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The list is empty' using hint = 'empty'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Up to 5,000 people per list' using hint = 'too_many'; end if;
  select * into s from reactivation_settings where id;
  lic := coalesce((select coalesce(licensed_states, states) from agent_lead_settings where agent_id = me), '{}');
  insert into reactivation_lists (agent_id, name, status, uploaded, price_cents_each, attest_text, attest_version, attested_at)
  values (me, left(coalesce(nullif(trim(p_name), ''), 'Old leads'), 120), 'draft', jsonb_array_length(p_rows), s.price_cents,
          'These people asked to be contacted about life insurance, and I have the right to have them contacted by phone. I’m responsible for this list.',
          left(coalesce(p_attest_version, 'p952-v1'), 40), now())
  returning id into lid;
  for x in select * from jsonb_array_elements(p_rows) loop
    ph := reactivation_phone(x ->> 'phone');
    st := upper(trim(coalesce(x ->> 'state', '')));
    why := null;
    if ph is null then why := 'bad_number';
    elsif ph = any(seen) then why := 'duplicate';
    elsif exists (select 1 from leads l where l.assigned_rep_id = me and sms_e164(l.phone) = ph)
       or exists (select 1 from policies p where p.agent_id = me and sms_e164(p.client_phone) = ph) then why := 'existing';
    elsif st !~ '^[A-Z]{2}$' or not (st = any(lic)) then why := 'unlicensed';
    else
      select * into d from dnc_numbers where phone = ph;
      if sms_is_opted_out(ph) or coalesce(d.internal, false) or coalesce(d.national, false) then why := 'dnc'; end if;
    end if;
    if ph is not null then seen := seen || ph; end if;
    if why is not null then rm := jsonb_set(rm, array[why], to_jsonb((rm ->> why)::int + 1)); continue; end if;
    insert into reactivation_contacts (list_id, agent_id, first_name, last_name, phone, state, age, mortgage_cents, lead_date, source)
    values (lid, me, left(nullif(trim(x ->> 'first'), ''), 60), left(nullif(trim(x ->> 'last'), ''), 60), ph, st,
            case when (x ->> 'age') ~ '^\d{1,3}$' and (x ->> 'age')::int between 18 and 110 then (x ->> 'age')::int end,
            case when (x ->> 'mortgage_cents') ~ '^\d{1,12}$' and (x ->> 'mortgage_cents')::bigint > 0 then (x ->> 'mortgage_cents')::bigint end,
            left(nullif(trim(x ->> 'lead_date'), ''), 40), left(nullif(trim(x ->> 'source'), ''), 80));
    kept := kept + 1;
  end loop;
  if kept < s.min_leads then
    raise exception 'After cleaning, % people are left. A list needs at least %.', kept, s.min_leads using hint = 'below_min';
  end if;
  update reactivation_lists set removed = rm, callable = kept, amount_cents = kept * s.price_cents, updated_at = now() where id = lid;
  return jsonb_build_object('list_id', lid, 'uploaded', jsonb_array_length(p_rows), 'callable', kept, 'removed', rm,
                            'price_cents', s.price_cents, 'amount_cents', kept * s.price_cents);
end;
$$;
revoke execute on function public.reactivation_create(text, jsonb, boolean, text) from public, anon;
grant execute on function public.reactivation_create(text, jsonb, boolean, text) to authenticated;

-- A list not paid yet can be thrown away.
create or replace function public.reactivation_discard(p_list uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update reactivation_lists set status = 'cancelled', updated_at = now()
   where id = p_list and agent_id = auth.uid() and status in ('draft', 'payment_failed');
  if not found then raise exception 'Only a list that isn''t paid can be removed' using errcode = '42501'; end if;
  update reactivation_contacts set status = 'removed', removed_reason = 'list_cancelled', next_at = null, updated_at = now() where list_id = p_list;
end;
$$;
revoke execute on function public.reactivation_discard(uuid) from public, anon;
grant execute on function public.reactivation_discard(uuid) to authenticated;

-- The agent's lists with their progress card numbers.
create or replace function public.my_reactivation_lists()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'status', l.status, 'created_at', l.created_at,
           'uploaded', l.uploaded, 'removed', l.removed, 'callable', l.callable, 'amount_cents', l.amount_cents,
           'price_cents_each', l.price_cents_each, 'refunded_cents', l.refunded_cents, 'paid_at', l.paid_at, 'started_at', l.started_at,
           'progress', reactivation_progress(l.id)) order by l.created_at desc), '[]'::jsonb)
    from reactivation_lists l where l.agent_id = auth.uid() and l.status <> 'cancelled'
$$;
revoke execute on function public.my_reactivation_lists() from public, anon;
grant execute on function public.my_reactivation_lists() to authenticated;

-- ── 12. Money: one charge per list (lead-spend charges it; statement OHVARA LEADS) ──────────────────────────────
alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly', 'plan_upgrade', 'signup', 'plan_month', 'live_check', 'reactivation'));

-- lead-spend (service role) asks for the charge. The agent's own unpaid list only.
create or replace function public.reactivation_charge_start(p_list uuid, p_agent uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare rl reactivation_lists; ch uuid; n int;
begin
  select * into rl from reactivation_lists where id = p_list for update;
  if rl.id is null or rl.agent_id is distinct from p_agent then raise exception 'No such list' using errcode = '42501'; end if;
  if rl.status not in ('draft', 'payment_failed') then raise exception 'This list is already paid' using hint = 'already_paid'; end if;
  if rl.amount_cents <= 0 then raise exception 'Nothing to charge' using hint = 'empty'; end if;
  select count(*) into n from lead_spend_charges where key like 'reactivation:' || p_list || ':%';
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
  values (rl.agent_id, billing_week_of(billing_today()), 'reactivation', rl.amount_cents, 'reactivation:' || p_list || ':' || (n + 1),
          left('Reactivation · ' || rl.callable || ' leads · $' || to_char(rl.amount_cents / 100.0, 'FM999,990.##'), 300))
  returning id into ch;
  update reactivation_lists set status = 'waiting_payment', charge_id = ch, updated_at = now() where id = p_list;
  return jsonb_build_object('charge_id', ch, 'amount_cents', rl.amount_cents);
end;
$$;
revoke execute on function public.reactivation_charge_start(uuid, uuid) from public, anon, authenticated;

create or replace function public.reactivation_charge_result(c lead_spend_charges, p_status text, p_pi text, p_failure text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid := split_part(c.key, ':', 2)::uuid; rl reactivation_lists;
begin
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = c.id;
  if p_status = 'paid' then
    update reactivation_lists set status = 'waiting_scrub', paid_at = now(), updated_at = now()
     where id = lid and status in ('waiting_payment', 'payment_failed', 'draft') returning * into rl;
    update reactivation_contacts set status = 'waiting_scrub', updated_at = now() where list_id = lid and status <> 'removed';
    perform billing_log(c.agent_id, 'reactivation_paid', null, jsonb_build_object('charge', c.id, 'list', lid, 'cents', c.amount_cents), null);
  elsif p_status = 'failed' then
    update reactivation_lists set status = 'payment_failed', updated_at = now() where id = lid and status = 'waiting_payment';
  end if;
  return jsonb_build_object('status', p_status, 'list_id', lid);
end;
$$;
revoke execute on function public.reactivation_charge_result(lead_spend_charges, text, text, text) from public, anon, authenticated;

alter function public.lead_spend_charge_result(uuid, text, text, text) rename to lead_spend_charge_result_p951;
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  select * into c from lead_spend_charges where id = p_id;
  if not found then raise exception 'no such charge'; end if;
  if c.kind <> 'reactivation' then return lead_spend_charge_result_p951(p_id, p_status, p_pi, p_failure); end if;
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  return reactivation_charge_result(c, p_status, p_pi, p_failure);
end; $$;
revoke execute on function public.lead_spend_charge_result(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.lead_spend_charge_result_p951(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.lead_spend_charge_result(uuid, text, text, text) to service_role;

-- Refunds the scrub made due (lead-spend's cron pays them back on the same charge). Then the note says so.
create or replace function public.reactivation_refunds_due()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('list_id', l.id, 'charge_id', l.charge_id, 'pi', c.stripe_pi, 'cents', l.refund_due_cents - l.refunded_cents,
                            'key', 'reactivation_refund:' || l.id || ':' || l.refund_due_cents)
    from reactivation_lists l join lead_spend_charges c on c.id = l.charge_id
   where l.refund_due_cents > l.refunded_cents and c.status = 'paid' and c.stripe_pi is not null
$$;
create or replace function public.reactivation_refunded(p_list uuid, p_cents int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rl reactivation_lists;
begin
  update reactivation_lists set refunded_cents = least(refund_due_cents, refunded_cents + greatest(0, p_cents)), updated_at = now()
   where id = p_list returning * into rl;
  if rl.id is null then raise exception 'no such list'; end if;
  perform billing_charge_refunded(rl.charge_id, p_cents);
  update lead_spend_charges set note = left('Reactivation · ' || rl.callable || ' leads · $' || to_char(amount_cents / 100.0, 'FM999,990.##')
                                            || ' · $' || to_char(rl.refunded_cents / 100.0, 'FM999,990.##') || ' back (taken off by the Do Not Call check)', 300)
   where id = rl.charge_id;
  return jsonb_build_object('refunded_cents', rl.refunded_cents);
end;
$$;
revoke execute on function public.reactivation_refunds_due(), public.reactivation_refunded(uuid, int) from public, anon, authenticated;

-- lead-spend asks before a live-key charge (a test key always charges, test mode).
create or replace function public.reactivation_is_live() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select reactivation_live from recovery_config limit 1), false)
$$;
revoke execute on function public.reactivation_is_live() from public, anon, authenticated;

-- ── 13. The Do Not Call + litigator scrub (the reactivation function, service role) ─────────────────────────────
-- Paid lists waiting for the scrub, with their numbers. Nothing while no scrub provider is connected.
create or replace function public.reactivation_scrub_claim(p_limit int default 3)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('list_id', l.id, 'phones', (select jsonb_agg(phone) from reactivation_contacts where list_id = l.id and status = 'waiting_scrub'))
    from reactivation_lists l
   where l.status = 'waiting_scrub' and (select scrub_provider from reactivation_settings where id) <> 'none'
   order by l.paid_at limit greatest(1, least(p_limit, 20))
$$;

-- The scrub's answer: p_flagged = [{ phone, reason: national_dnc | litigator }]. Flagged people come off (and their
-- price is paid back), national DNC numbers are remembered, and the list starts: attempt 1 due now (in hours).
create or replace function public.reactivation_scrub_done(p_list uuid, p_flagged jsonb, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rl reactivation_lists; f jsonb; n_nat int := 0; n_lit int := 0; n int := 0;
begin
  select * into rl from reactivation_lists where id = p_list for update;
  if rl.id is null or rl.status <> 'waiting_scrub' then return jsonb_build_object('ok', false, 'code', 'not_waiting'); end if;
  for f in select * from jsonb_array_elements(coalesce(p_flagged, '[]'::jsonb)) loop
    update reactivation_contacts set status = 'removed', removed_reason = case when f ->> 'reason' = 'litigator' then 'litigator' else 'national_dnc' end,
           next_at = null, updated_at = now()
     where list_id = p_list and phone = reactivation_phone(f ->> 'phone') and status = 'waiting_scrub';
    if found then
      n := n + 1;
      if f ->> 'reason' = 'litigator' then n_lit := n_lit + 1;
      else
        n_nat := n_nat + 1;
        insert into dnc_numbers (phone, national, national_checked_at, source)
        values (reactivation_phone(f ->> 'phone'), true, now(), 'reactivation_scrub')
        on conflict (phone) do update set national = true, national_checked_at = now();
      end if;
    end if;
  end loop;
  update reactivation_lists set status = 'working', scrubbed_at = now(), scrub_provider = left(p_provider, 40), started_at = now(),
         callable = callable - n, refund_due_cents = refund_due_cents + n * price_cents_each,
         removed = removed || jsonb_build_object('national_dnc', n_nat, 'litigator', n_lit), updated_at = now()
   where id = p_list;
  update reactivation_contacts set status = 'queued', next_at = now(), updated_at = now() where list_id = p_list and status = 'waiting_scrub';
  return jsonb_build_object('ok', true, 'removed', n, 'national_dnc', n_nat, 'litigator', n_lit, 'refund_cents', n * rl.price_cents_each);
end;
$$;
revoke execute on function public.reactivation_scrub_claim(int), public.reactivation_scrub_done(uuid, jsonb, text) from public, anon, authenticated;

-- pg_cron, every 5 minutes: only when a scrub provider is connected and a paid list is waiting, ask the function.
create or replace function public.reactivation_scrub_kick() returns boolean language plpgsql security definer set search_path = public as $$
begin
  if (select scrub_provider from reactivation_settings where id) = 'none'
     or not exists (select 1 from reactivation_lists where status = 'waiting_scrub') then return false; end if;
  perform fulfillment_cron_post('reactivation', jsonb_build_object('action', 'scrub'));
  return true;
exception when others then raise warning 'reactivation_scrub_kick: %', sqlerrm; return false;
end;
$$;
revoke execute on function public.reactivation_scrub_kick() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reactivation-scrub', '*/5 * * * *', 'select public.reactivation_scrub_kick()');
  end if;
exception when others then raise warning 'reactivation-scrub schedule: %', sqlerrm;
end $$;

-- ── 14. Admin ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reactivation_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s reactivation_settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into s from reactivation_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('price_cents', s.price_cents, 'min_leads', s.min_leads, 'max_attempts', s.max_attempts,
                  'pause_stop_rate', s.pause_stop_rate, 'pause_min_reached', s.pause_min_reached, 'scrub_provider', s.scrub_provider,
                  'live', coalesce((select reactivation_live from recovery_config limit 1), false),
                  'numbers', (select count(*) from deedstone_numbers where active and pool = 'reactivation')),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'status', l.status, 'agent_id', l.agent_id,
               'agent', (select full_name from profiles where id = l.agent_id), 'created_at', l.created_at, 'uploaded', l.uploaded,
               'removed', l.removed, 'callable', l.callable, 'amount_cents', l.amount_cents, 'refunded_cents', l.refunded_cents,
               'paused_at', l.paused_at, 'pause_reason', l.pause_reason, 'progress', reactivation_progress(l.id),
               'cost_cents', (select coalesce(sum(c.cost_cents), 0) from ai_calls c join reactivation_contacts rc on rc.id = c.reactivation_contact_id
                               where rc.list_id = l.id)) order by l.created_at desc)
               from reactivation_lists l where l.status <> 'cancelled'), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_reactivation_view() from public, anon;
grant execute on function public.admin_reactivation_view() to authenticated;

create or replace function public.admin_reactivation_settings_save(p_price_cents int, p_min_leads int, p_max_attempts int,
  p_pause_stop_rate numeric default null, p_pause_min_reached int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update reactivation_settings set price_cents = coalesce(p_price_cents, price_cents), min_leads = coalesce(p_min_leads, min_leads),
         max_attempts = coalesce(p_max_attempts, max_attempts), pause_stop_rate = coalesce(p_pause_stop_rate, pause_stop_rate),
         pause_min_reached = coalesce(p_pause_min_reached, pause_min_reached), updated_at = now(), updated_by = auth.uid()
   where id;
  return (select to_jsonb(s) - 'scrub_provider' from reactivation_settings s where id);
end;
$$;
revoke execute on function public.admin_reactivation_settings_save(int, int, int, numeric, int) from public, anon;
grant execute on function public.admin_reactivation_settings_save(int, int, int, numeric, int) to authenticated;

-- Pause or resume one list (resume only once the admin has looked; a list never resumes itself).
create or replace function public.admin_reactivation_pause(p_list uuid, p_pause boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare st text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update reactivation_lists set status = case when p_pause then 'paused' else 'working' end,
         paused_at = case when p_pause then now() end, pause_reason = case when p_pause then 'Paused by an admin' end, updated_at = now()
   where id = p_list and status in ('working', 'paused') returning status into st;
  if st is null then raise exception 'Only a list that is calling or paused' using errcode = '22023'; end if;
  return st;
end;
$$;
revoke execute on function public.admin_reactivation_pause(uuid, boolean) from public, anon;
grant execute on function public.admin_reactivation_pause(uuid, boolean) to authenticated;
