-- P916 — Every call shows "Deedstone Insurance": a pool of branded numbers, agents call through it from their own
-- phone, callbacks find the right agent.
--
-- NOT APPLIED. Apply only with Brayden's yes (Parallel rule 4: 255 is the number after P915's 254). Additive only:
-- new tables, two app_settings columns, new functions, one notification type, one help_calls column. Nothing is
-- dropped, renamed or emptied. recovery_config.voice_live stays off, so nothing here places a real call.
--
-- APPLY ORDER: after 091 (app_settings), 156 (notify), 183 (lead_sms_match), 197 (agent_in_working_hours),
-- 236 (predial_eval, route_notify_admins, call_attempts).
--
-- How it works (How Ohvara Works → "Deedstone on every call"):
--   deedstone_numbers       Ohvara's Twilio numbers, all branded "Deedstone Insurance" (CNAM: DEEDSTONE INS).
--   deedstone_agent_lines   one row per agent: the pool number they were quietly given (kept for good, so a client
--                           always sees the same Deedstone number from their agent) and the agent's own phone,
--                           confirmed by a voice call that reads a code. Agents never see the number or the pool.
--   deedstone_number_use    every outbound call placed from a pool number (agent call, AI call, VA call, transfer,
--                           code call): calls per number per day for admin, and the "add a number" warning.
--   deedstone_calls         an agent's Call: their phone rings first, then the client is dialed from the agent's
--                           Deedstone number (help-voice runs the TwiML).
--   deedstone_inbound       a call to any Deedstone number: who called, which agent it went to, whether they took it.
-- Filling the pool: a number takes agents until its load (each agent's busiest-day calls over the last 7 days, or
-- at least the per-agent estimate) would pass the daily limit, then the next agent gets the next number.

-- ── 1. Settings ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.app_settings add column if not exists deedstone_daily_limit int not null default 120
  check (deedstone_daily_limit between 10 and 2000);
alter table public.app_settings add column if not exists deedstone_agent_estimate int not null default 30
  check (deedstone_agent_estimate between 1 and 500);
comment on column public.app_settings.deedstone_daily_limit is
  'P916: outbound calls a day one Deedstone number should carry before the next agent gets the next number.';
comment on column public.app_settings.deedstone_agent_estimate is
  'P916: calls a day assumed for an agent with no call history yet, when filling a number.';

-- ── 2. Tables ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.deedstone_numbers (
  id                 uuid primary key default gen_random_uuid(),
  phone              text not null unique check (phone ~ '^\+1[2-9][0-9]{9}$'),
  label              text check (label is null or char_length(label) <= 60),
  caller_name        text not null default 'DEEDSTONE INS' check (char_length(caller_name) between 1 and 15),
  provider_number_id text check (provider_number_id is null or char_length(provider_number_id) <= 120),  -- the AI provider's id for this number (Vapi)
  active             boolean not null default true,
  sort               int not null default 0,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.deedstone_numbers enable row level security;
drop policy if exists deedstone_numbers_admin on public.deedstone_numbers;
create policy deedstone_numbers_admin on public.deedstone_numbers for select to authenticated using (public.is_admin());

create table if not exists public.deedstone_agent_lines (
  agent_id         uuid primary key references public.profiles(id) on delete cascade,
  number_id        uuid references public.deedstone_numbers(id) on delete set null,
  assigned_at      timestamptz,
  call_phone       text check (call_phone is null or call_phone ~ '^\+1[2-9][0-9]{9}$'),
  call_phone_at    timestamptz,                       -- confirmed by the code call
  pending_phone    text check (pending_phone is null or pending_phone ~ '^\+1[2-9][0-9]{9}$'),
  code_hash        text,
  code_expires_at  timestamptz,
  code_tries       int not null default 0,
  code_calls       timestamptz[] not null default '{}',  -- code calls placed (rate limit)
  updated_at       timestamptz not null default now()
);
alter table public.deedstone_agent_lines enable row level security;
-- The code hash lives here: agents read their own row only through my_deedstone_phone().
drop policy if exists deedstone_agent_lines_admin on public.deedstone_agent_lines;
create policy deedstone_agent_lines_admin on public.deedstone_agent_lines for select to authenticated using (public.is_admin());

create table if not exists public.deedstone_number_use (
  id         bigint generated always as identity primary key,
  number_id  uuid not null references public.deedstone_numbers(id) on delete cascade,
  kind       text not null check (kind in ('agent_call', 'ai_call', 'va_call', 'transfer', 'code')),
  agent_id   uuid references public.profiles(id) on delete set null,
  ref        text,
  at         timestamptz not null default now()
);
create index if not exists deedstone_number_use_idx on public.deedstone_number_use (number_id, at desc);
create index if not exists deedstone_number_use_agent_idx on public.deedstone_number_use (agent_id, at desc);
alter table public.deedstone_number_use enable row level security;
drop policy if exists deedstone_number_use_admin on public.deedstone_number_use;
create policy deedstone_number_use_admin on public.deedstone_number_use for select to authenticated using (public.is_admin());

create table if not exists public.deedstone_calls (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  policy_id        uuid references public.policies(id) on delete set null,
  number_id        uuid references public.deedstone_numbers(id) on delete set null,
  from_number      text not null,
  agent_phone      text not null,
  client_phone     text not null,
  client_name      text,
  state            text,
  agent_call_sid   text,
  client_call_sid  text,
  status           text not null default 'calling_agent'
                     check (status in ('calling_agent', 'agent_on', 'calling_client', 'live', 'ended')),
  end_reason       text,
  created_at       timestamptz not null default now(),
  agent_on_at      timestamptz,
  connected_at     timestamptz,
  ended_at         timestamptz
);
create index if not exists deedstone_calls_agent_idx on public.deedstone_calls (agent_id, created_at desc);
alter table public.deedstone_calls enable row level security;
drop policy if exists deedstone_calls_read on public.deedstone_calls;
create policy deedstone_calls_read on public.deedstone_calls for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());

create table if not exists public.deedstone_inbound (
  call_sid       text primary key,
  caller         text,
  to_number      text,
  agent_id       uuid references public.profiles(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  policy_id      uuid references public.policies(id) on delete set null,
  name           text,
  routed         text not null check (routed in ('agent', 'va')),
  agent_took_at  timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.deedstone_inbound enable row level security;
drop policy if exists deedstone_inbound_admin on public.deedstone_inbound;
create policy deedstone_inbound_admin on public.deedstone_inbound for select to authenticated using (public.is_admin());

-- ── 3. Notification type ────────────────────────────────────────────────────────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select 'deedstone_number_hot', array['admin'], 'A Deedstone number is running hot: add a number', false, null, true, true,
       false, true, coalesce((select max(sort) from public.notification_types), 0) + 1
 where not exists (select 1 from public.notification_types where type = 'deedstone_number_hot');

-- ── 4. Load and assignment ──────────────────────────────────────────────────────────────────────────────────────
-- The Central-time day a moment falls on (VA hours and the pool's "per day" are both Central).
create or replace function public.deedstone_day(p_at timestamptz)
returns date language sql immutable as $$ select (p_at at time zone 'America/Chicago')::date $$;

create or replace function public.deedstone_settings()
returns table (daily_limit int, agent_estimate int) language sql stable security definer set search_path = public as $$
  select coalesce((select deedstone_daily_limit from app_settings where id = 1), 120),
         coalesce((select deedstone_agent_estimate from app_settings where id = 1), 30)
$$;

-- Calls today on a number.
create or replace function public.deedstone_today(p_number uuid, p_at timestamptz default now())
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from deedstone_number_use
   where number_id = p_number and at > p_at - interval '2 days' and deedstone_day(at) = deedstone_day(p_at)
$$;

-- An agent's expected calls a day: their busiest day over the last 7, never under the per-agent estimate (a
-- new agent's first few calls don't make them look light).
create or replace function public.deedstone_agent_load(p_agent uuid, p_at timestamptz default now())
returns int language sql stable security definer set search_path = public as $$
  select greatest(coalesce(max(n), 0), (select agent_estimate from deedstone_settings()))::int
    from (select count(*) n from deedstone_number_use
           where agent_id = p_agent and at > p_at - interval '7 days' group by deedstone_day(at)) d
$$;

-- A number's expected load: the agents on it.
create or replace function public.deedstone_number_load(p_number uuid, p_at timestamptz default now())
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(deedstone_agent_load(agent_id, p_at)), 0)::int from deedstone_agent_lines where number_id = p_number
$$;

-- The agent's number, given quietly the first time it's needed and kept. A number takes agents until the new
-- agent's load would pass the limit; when every number is full the least-loaded one is used and admins are told
-- to add a number. Null when the pool is empty (callers fall back to the old single number).
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
   where l.agent_id = p_agent and x.active;
  if n.id is not null then return n; end if;
  perform pg_advisory_xact_lock(hashtext('deedstone_assign'));
  need := deedstone_agent_load(p_agent);
  select x.* into n from deedstone_numbers x
   where x.active and deedstone_number_load(x.id) + need <= lim
   order by x.sort, x.created_at limit 1;
  if n.id is null then
    full_ := true;
    select x.* into n from deedstone_numbers x where x.active
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

-- The caller ID for a call about this agent's lead or client: their Deedstone number. p_kind logs one outbound
-- call on it (null: no log, e.g. a call to the agent's own phone). Over 90% of the limit today → admins are told
-- once a day per number. Null when the agent is unknown or the pool is empty.
create or replace function public.deedstone_from(p_agent uuid, p_kind text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare n public.deedstone_numbers; today int; lim int := (select daily_limit from deedstone_settings());
begin
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
  return jsonb_build_object('phone', n.phone, 'provider_number_id', n.provider_number_id, 'number_id', n.id);
end;
$$;

-- ── 5. Connect your phone (agent Settings) ──────────────────────────────────────────────────────────────────────
-- fulfillment-call (service role): a 6-digit code for a voice call to p_phone. At most 3 code calls an hour.
create or replace function public.deedstone_code_begin(p_agent uuid, p_phone text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare e text := sms_e164(p_phone); code text; l deedstone_agent_lines;
begin
  if e is null or e !~ '^\+1[2-9][0-9]{9}$' then raise exception 'bad_phone' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_agent and role::text = 'agent' and coalesce(is_active, true)) then
    raise exception 'not_agent' using errcode = '42501';
  end if;
  insert into deedstone_agent_lines (agent_id) values (p_agent) on conflict (agent_id) do nothing;
  select * into l from deedstone_agent_lines where agent_id = p_agent for update;
  if (select count(*) from unnest(l.code_calls) t where t > now() - interval '1 hour') >= 3 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update deedstone_agent_lines
     set pending_phone = e, code_hash = encode(sha256(convert_to(p_agent::text || ':' || code, 'UTF8')), 'hex'),
         code_expires_at = now() + interval '10 minutes', code_tries = 0,
         code_calls = array(select t from unnest(l.code_calls) t where t > now() - interval '1 day') || now(),
         updated_at = now()
   where agent_id = p_agent;
  return code;
end;
$$;

-- The agent types the code they heard.
create or replace function public.deedstone_code_confirm(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); l deedstone_agent_lines;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into l from deedstone_agent_lines where agent_id = me for update;
  if l.code_hash is null or l.pending_phone is null then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  if l.code_expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if l.code_tries >= 5 then return jsonb_build_object('ok', false, 'reason', 'too_many_tries'); end if;
  if encode(sha256(convert_to(me::text || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'UTF8')), 'hex') <> l.code_hash then
    update deedstone_agent_lines set code_tries = code_tries + 1, updated_at = now() where agent_id = me;
    return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'tries_left', 4 - l.code_tries);
  end if;
  update deedstone_agent_lines
     set call_phone = l.pending_phone, call_phone_at = now(), pending_phone = null, code_hash = null,
         code_expires_at = null, code_tries = 0, updated_at = now()
   where agent_id = me;
  return jsonb_build_object('ok', true, 'phone', l.pending_phone);
end;
$$;

-- What agent Settings shows: their connected phone (never the Deedstone number).
create or replace function public.my_deedstone_phone()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phone', l.call_phone, 'connected_at', l.call_phone_at,
    'pending', l.pending_phone is not null and l.code_expires_at > now(), 'pending_phone', l.pending_phone)
    from (select 1) x left join deedstone_agent_lines l on l.agent_id = auth.uid()
$$;

create or replace function public.deedstone_phone_disconnect()
returns void language sql volatile security definer set search_path = public as $$
  update deedstone_agent_lines set call_phone = null, call_phone_at = null, pending_phone = null, code_hash = null,
         code_expires_at = null, updated_at = now()
   where agent_id = auth.uid()
$$;

-- ── 6. An agent's Call ──────────────────────────────────────────────────────────────────────────────────────────
-- fulfillment-call (service role) before ringing the agent: their lead or client, a connected phone, a Deedstone
-- number, and the pre-dial check (consent, do not call, the state's hours, the attempt cap). ok + the call row, or
-- the reason it can't go (and when it can, for hours and the cap).
create or replace function public.deedstone_call_begin(p_agent uuid, p_lead uuid, p_policy uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me   profiles;
  l    leads;
  p    policies;
  dl   deedstone_agent_lines;
  phone text;
  st   text;
  nm   text;
  chk  record;
  num  jsonb;
  id_  uuid;
begin
  select * into me from profiles where id = p_agent;
  if me.id is null or me.role::text <> 'agent' or not coalesce(me.is_active, true) then
    return jsonb_build_object('ok', false, 'reason', 'not_agent');
  end if;
  if coalesce(me.is_demo, false) then return jsonb_build_object('ok', false, 'reason', 'demo'); end if;
  if p_policy is not null then
    select * into p from policies where id = p_policy;
    if p.id is null or p.agent_id <> p_agent then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
    if coalesce(p.is_demo, false) then return jsonb_build_object('ok', false, 'reason', 'demo'); end if;
    phone := sms_e164(p.client_phone); st := p.state; nm := trim(p.client_first_name || ' ' || p.client_last_name);
  elsif p_lead is not null then
    select * into l from leads where id = p_lead;
    if l.id is null or l.assigned_rep_id is distinct from p_agent then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
    phone := sms_e164(l.phone); st := l.state; nm := coalesce(l.contact_name, l.business_name);
  else
    return jsonb_build_object('ok', false, 'reason', 'no_task');
  end if;
  if phone is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;

  select * into dl from deedstone_agent_lines where agent_id = p_agent;
  if dl.call_phone is null then return jsonb_build_object('ok', false, 'reason', 'no_agent_phone'); end if;

  select * into chk from predial_eval(phone, st, p_lead, 'call', now(), p_policy, false);
  if not chk.ok then return jsonb_build_object('ok', false, 'reason', chk.reason, 'next_at', chk.next_at); end if;

  -- One call at a time per agent: an open one older than 10 minutes is stale and closed here.
  update deedstone_calls set status = 'ended', end_reason = 'stale', ended_at = now()
   where agent_id = p_agent and status <> 'ended' and created_at < now() - interval '10 minutes';
  if exists (select 1 from deedstone_calls where agent_id = p_agent and status <> 'ended') then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;

  num := deedstone_from(p_agent, 'agent_call', coalesce(p_policy, p_lead)::text);
  if num is null then return jsonb_build_object('ok', false, 'reason', 'no_number'); end if;
  insert into deedstone_calls (agent_id, lead_id, policy_id, number_id, from_number, agent_phone, client_phone, client_name, state)
  values (p_agent, p_lead, p_policy, (num ->> 'number_id')::uuid, num ->> 'phone', dl.call_phone, phone, nm, upper(nullif(trim(st), '')))
  returning id into id_;
  return jsonb_build_object('ok', true, 'call_id', id_, 'from', num ->> 'phone', 'agent_phone', dl.call_phone,
                            'client_phone', phone, 'name', nm);
end;
$$;

-- help-voice: the agent pressed 1. The pre-dial check once more at the moment of the dial, and the attempt logged.
create or replace function public.deedstone_call_connect(p_call uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c deedstone_calls; chk record;
begin
  select * into c from deedstone_calls where id = p_call for update;
  if c.id is null or c.status not in ('calling_agent', 'agent_on') then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select * into chk from predial_eval(c.client_phone, c.state, c.lead_id, 'call', now(), c.policy_id, false);
  if not chk.ok then
    update deedstone_calls set status = 'ended', end_reason = 'predial_' || chk.reason, ended_at = now() where id = p_call;
    return jsonb_build_object('ok', false, 'reason', chk.reason);
  end if;
  update deedstone_calls set status = 'calling_client', agent_on_at = coalesce(agent_on_at, now()) where id = p_call;
  perform predial_log_attempt(c.client_phone, c.lead_id, c.policy_id, null, c.agent_id);
  return jsonb_build_object('ok', true, 'from', c.from_number, 'client_phone', c.client_phone, 'name', c.client_name);
end;
$$;

-- ── 7. Calls in ─────────────────────────────────────────────────────────────────────────────────────────────────
-- help-voice: someone rang a Deedstone number. Who it is by their number (a client's policy first, then a lead),
-- and whether their agent can take it now: active, a connected phone, inside their working hours. Saved once per
-- call (a retried webhook gets the same answer). A lead who called gave consent by calling.
create or replace function public.deedstone_inbound_start(p_call_sid text, p_caller text, p_to text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e     text := sms_e164(p_caller);
  had   deedstone_inbound;
  pol   policies;
  lead  uuid;
  ag    uuid;
  nm    text;
  ph    text;
  go    boolean := false;
begin
  select * into had from deedstone_inbound where call_sid = p_call_sid;
  if had.call_sid is not null then
    return jsonb_build_object('agent', had.routed = 'agent' and had.agent_took_at is null,
      'phone', (select call_phone from deedstone_agent_lines where agent_id = had.agent_id), 'name', had.name, 'again', true);
  end if;
  if e is not null then
    select * into pol from policies where sms_e164(client_phone) = e and not coalesce(is_demo, false)
     order by created_at desc limit 1;
    if pol.id is not null then
      ag := pol.agent_id; nm := trim(pol.client_first_name || ' ' || pol.client_last_name);
    else
      lead := lead_sms_match(e);
      if lead is not null then
        select assigned_rep_id, coalesce(contact_name, business_name) into ag, nm from leads where id = lead;
        update leads set call_consent_at = coalesce(call_consent_at, now()) where id = lead;
      end if;
    end if;
  end if;
  if ag is not null then
    select l.call_phone into ph from deedstone_agent_lines l join profiles p on p.id = l.agent_id
     where l.agent_id = ag and p.role::text = 'agent' and coalesce(p.is_active, true) and not coalesce(p.is_demo, false);
    go := ph is not null and agent_in_working_hours(ag, now());
  end if;
  insert into deedstone_inbound (call_sid, caller, to_number, agent_id, lead_id, policy_id, name, routed)
  values (p_call_sid, e, sms_e164(p_to), ag, lead, pol.id, nm, case when go then 'agent' else 'va' end)
  on conflict (call_sid) do nothing;
  return jsonb_build_object('agent', go, 'phone', case when go then ph end, 'name', nm, 'known', ag is not null);
end;
$$;

-- The agent pressed 1 on the whisper.
create or replace function public.deedstone_inbound_took(p_call_sid text)
returns void language sql volatile security definer set search_path = public as $$
  update deedstone_inbound set agent_took_at = coalesce(agent_took_at, now()) where call_sid = p_call_sid and routed = 'agent'
$$;

-- The agent's ring ended: true when they took it; otherwise the call goes on to the VA desk.
create or replace function public.deedstone_inbound_done(p_call_sid text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare r deedstone_inbound;
begin
  select * into r from deedstone_inbound where call_sid = p_call_sid;
  if r.call_sid is null then return false; end if;
  if r.agent_took_at is not null then return true; end if;
  update deedstone_inbound set routed = 'va' where call_sid = p_call_sid;
  return false;
end;
$$;

-- ── 8. Admin: Settings → Deedstone numbers ──────────────────────────────────────────────────────────────────────
create or replace function public.admin_deedstone_numbers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; out_ jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into s from deedstone_settings();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'phone', x.phone, 'label', x.label, 'caller_name', x.caller_name, 'active', x.active,
           'provider_number_id', x.provider_number_id,
           'agents', (select count(*) from deedstone_agent_lines l where l.number_id = x.id),
           'load', deedstone_number_load(x.id),
           'today', deedstone_today(x.id),
           'days', (select jsonb_agg(jsonb_build_object('day', d::date, 'calls',
                      (select count(*) from deedstone_number_use u where u.number_id = x.id and u.at > now() - interval '8 days'
                          and deedstone_day(u.at) = d::date)) order by d)
                      from generate_series((deedstone_day(now()) - 6)::timestamp, deedstone_day(now())::timestamp, interval '1 day') d),
           'hot', deedstone_today(x.id) >= ceil(s.daily_limit * 0.9),
           'full', deedstone_number_load(x.id) + s.agent_estimate > s.daily_limit
         ) order by x.sort, x.created_at), '[]'::jsonb)
    into out_ from deedstone_numbers x;
  return jsonb_build_object('limit', s.daily_limit, 'estimate', s.agent_estimate, 'numbers', out_,
    'add_number', not exists (select 1 from jsonb_array_elements(out_) n
                               where (n ->> 'active')::boolean and not (n ->> 'hot')::boolean and not (n ->> 'full')::boolean),
    'agents_without_phone', (select count(*) from profiles p left join deedstone_agent_lines l on l.agent_id = p.id
                              where p.role::text = 'agent' and coalesce(p.is_active, true) and not coalesce(p.is_demo, false)
                                and l.call_phone is null));
end;
$$;

-- Add (p_id null) or change a number. A number is never deleted: turning it off keeps its agents' history, and
-- those agents get a new number the next time they call.
create or replace function public.admin_deedstone_number_save(p_id uuid, p_phone text, p_label text default null,
  p_caller_name text default null, p_provider_number_id text default null, p_active boolean default true)
returns public.deedstone_numbers language plpgsql volatile security definer set search_path = public as $$
declare n deedstone_numbers; e text := sms_e164(p_phone);
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if e is null then raise exception 'Enter a 10-digit US number' using errcode = '22023'; end if;
  if p_id is null then
    insert into deedstone_numbers (phone, label, caller_name, provider_number_id, active, sort, created_by)
    values (e, nullif(trim(p_label), ''), coalesce(nullif(upper(trim(p_caller_name)), ''), 'DEEDSTONE INS'),
            nullif(trim(p_provider_number_id), ''), coalesce(p_active, true),
            coalesce((select max(sort) + 1 from deedstone_numbers), 0), auth.uid())
    returning * into n;
  else
    update deedstone_numbers
       set phone = e, label = nullif(trim(p_label), ''),
           caller_name = coalesce(nullif(upper(trim(p_caller_name)), ''), caller_name),
           provider_number_id = nullif(trim(p_provider_number_id), ''), active = coalesce(p_active, active), updated_at = now()
     where id = p_id returning * into n;
    if n.id is null then raise exception 'Number not found' using errcode = 'P0002'; end if;
  end if;
  return n;
end;
$$;

create or replace function public.admin_deedstone_settings(p_limit int, p_estimate int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update app_settings set deedstone_daily_limit = coalesce(p_limit, deedstone_daily_limit),
         deedstone_agent_estimate = coalesce(p_estimate, deedstone_agent_estimate), updated_at = now()
   where id = 1;
  return (select to_jsonb(s) from deedstone_settings() s);
end;
$$;

-- ── 9. Grants ───────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.deedstone_settings()', 'public.deedstone_today(uuid, timestamptz)', 'public.deedstone_agent_load(uuid, timestamptz)',
    'public.deedstone_number_load(uuid, timestamptz)', 'public.deedstone_assign(uuid)', 'public.deedstone_from(uuid, text, text)',
    'public.deedstone_code_begin(uuid, text)', 'public.deedstone_call_begin(uuid, uuid, uuid)', 'public.deedstone_call_connect(uuid)',
    'public.deedstone_inbound_start(text, text, text)', 'public.deedstone_inbound_took(text)', 'public.deedstone_inbound_done(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.deedstone_code_confirm(text)', 'public.my_deedstone_phone()', 'public.deedstone_phone_disconnect()',
    'public.admin_deedstone_numbers()',
    'public.admin_deedstone_number_save(uuid, text, text, text, text, boolean)', 'public.admin_deedstone_settings(int, int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on public.deedstone_numbers, public.deedstone_agent_lines, public.deedstone_number_use, public.deedstone_calls,
  public.deedstone_inbound from anon;
