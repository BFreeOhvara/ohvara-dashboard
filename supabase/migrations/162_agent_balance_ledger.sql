-- Migration 162 — prepaid lead balance: ledger, balance view, assignment.
-- Money + RLS: Opus-tier. Written only; never applied from a worktree.
--
-- Agents top up a prepaid balance (Stripe Checkout → credit_topup) and each
-- marketplace lead assigned to them is charged from it (assign_mp_lead).
-- The balance is never stored: it is the sum of agent_balance_ledger, which is
-- append-only. Corrections are new 'refund' / 'adjust' rows, never edits.
--
-- Depends on 161 (mp_leads, agent_lead_settings, recovery_config.mp_lead_price_cents).
-- Columns this file assumes from 161:
--   mp_leads(id uuid, state text, status text, assigned_agent_id uuid)
--   agent_lead_settings(agent_id uuid, active boolean, states text[], daily_cap int)
--   recovery_config.mp_lead_price_cents int (singleton row, id = true)
--
-- Safety, in layers:
--   * no client writes: RLS on, anon/authenticated get SELECT on own rows only;
--     service_role may INSERT (refund/adjust from an edge function) but never
--     UPDATE/DELETE/TRUNCATE.
--   * a trigger rejects UPDATE, DELETE and TRUNCATE for everyone, owner included.
--   * a trigger rejects any negative row that would take the agent below 0,
--     under a per-agent lock, so no path (not just assign_mp_lead) can overdraw.
--   * partial unique indexes: one charge per lead, one top-up per Stripe session.
--
-- Locking (no cycles, so no deadlocks):
--   assign_mp_lead: lead row FOR UPDATE → global assign lock → per-agent lock(s)
--   negative insert (charge/adjust): per-agent lock only
--   top-ups don't lock: a credit can't overdraw.

-- ── ledger ──────────────────────────────────────────────────────────────────
create table public.agent_balance_ledger (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references public.profiles(id) on delete restrict,
  kind              text not null check (kind in ('topup', 'lead_charge', 'refund', 'adjust')),
  amount_cents      integer not null check (amount_cents <> 0),
  lead_id           uuid references public.mp_leads(id) on delete restrict,
  stripe_session_id text check (stripe_session_id is null or length(btrim(stripe_session_id)) > 0),
  created_at        timestamptz not null default now(),
  check (kind <> 'topup'       or (amount_cents > 0 and stripe_session_id is not null)),
  check (kind <> 'lead_charge' or (amount_cents < 0 and lead_id is not null)),
  check (kind <> 'refund'      or amount_cents > 0)
);

create unique index agent_balance_ledger_one_charge_per_lead
  on public.agent_balance_ledger (lead_id) where kind = 'lead_charge';
create unique index agent_balance_ledger_one_topup_per_session
  on public.agent_balance_ledger (stripe_session_id) where kind = 'topup';
create index agent_balance_ledger_agent_time
  on public.agent_balance_ledger (agent_id, created_at);

alter table public.agent_balance_ledger enable row level security;

drop policy if exists agent_balance_ledger_own_read on public.agent_balance_ledger;
create policy agent_balance_ledger_own_read on public.agent_balance_ledger
  for select to authenticated using (agent_id = auth.uid());

revoke all on public.agent_balance_ledger from public, anon, authenticated, service_role;
grant select on public.agent_balance_ledger to authenticated;
grant select, insert on public.agent_balance_ledger to service_role;

-- Append-only: no UPDATE / DELETE / TRUNCATE, whoever asks.
create or replace function public.agent_balance_ledger_block_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  raise exception 'agent_balance_ledger is append-only (% not allowed); add a refund or adjust row instead', tg_op
    using errcode = '42501';
end;
$$;

create trigger agent_balance_ledger_no_update_delete
  before update or delete on public.agent_balance_ledger
  for each row execute function public.agent_balance_ledger_block_change();
create trigger agent_balance_ledger_no_truncate
  before truncate on public.agent_balance_ledger
  for each statement execute function public.agent_balance_ledger_block_change();

-- The per-agent lock every debit takes. Shared with assign_mp_lead.
create or replace function public.agent_balance_lock(p_agent_id uuid)
 returns void
 language sql
 set search_path to 'public'
as $$
  select pg_advisory_xact_lock(hashtextextended('agent_balance:' || p_agent_id::text, 0));
$$;

-- Never below 0: a debit locks the agent, then checks the live sum.
create or replace function public.agent_balance_ledger_guard_debit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_balance bigint;
begin
  if new.amount_cents < 0 then
    perform agent_balance_lock(new.agent_id);
    select coalesce(sum(amount_cents), 0) into v_balance
      from agent_balance_ledger where agent_id = new.agent_id;
    if v_balance + new.amount_cents < 0 then
      raise exception 'Insufficient balance: % cents available, % needed', v_balance, -new.amount_cents
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger agent_balance_ledger_guard_debit
  before insert on public.agent_balance_ledger
  for each row execute function public.agent_balance_ledger_guard_debit();

revoke execute on function public.agent_balance_ledger_block_change() from public, anon, authenticated;
revoke execute on function public.agent_balance_ledger_guard_debit()  from public, anon, authenticated;
revoke execute on function public.agent_balance_lock(uuid)             from public, anon, authenticated;
grant  execute on function public.agent_balance_lock(uuid)             to service_role;

-- ── balance view ────────────────────────────────────────────────────────────
-- security_invoker: the ledger's RLS applies, so an agent sees only their own
-- balance and anon sees nothing. Display only; debits re-check under the lock.
create or replace view public.agent_lead_balance
  with (security_invoker = true) as
  select agent_id, sum(amount_cents)::bigint as balance_cents
    from public.agent_balance_ledger
   group by agent_id;

revoke all on public.agent_lead_balance from public, anon, authenticated, service_role;
grant select on public.agent_lead_balance to authenticated, service_role;

-- ── assignment ──────────────────────────────────────────────────────────────
-- Returns the assigned agent's id, or null if nobody qualifies (lead stays
-- 'new', nothing charged). Safe to call again: an assigned lead returns its
-- agent without a second charge (and the unique index backs that up).
--
-- Round-robin: among qualifying agents, the one whose last lead charge is
-- oldest (never charged first), ties by agent_id. The global assign lock makes
-- that pointer consistent. Daily cap counts lead charges since midnight Central.
create or replace function public.assign_mp_lead(p_lead_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_lead      record;
  v_state     text;
  v_price     integer;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Chicago')) at time zone 'America/Chicago';
  v_agent     uuid;
  v_balance   bigint;
begin
  if p_lead_id is null then
    raise exception 'lead_id is required' using errcode = '22004';
  end if;

  select id, state, status, assigned_agent_id into v_lead
    from mp_leads where id = p_lead_id
    for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.assigned_agent_id is not null then
    return v_lead.assigned_agent_id;
  end if;
  if v_lead.status is distinct from 'new' then
    return null;
  end if;

  v_state := upper(btrim(v_lead.state));
  if v_state is null or v_state = '' then
    return null;
  end if;

  select mp_lead_price_cents into v_price from recovery_config where id;
  if v_price is null or v_price <= 0 then
    raise exception 'recovery_config.mp_lead_price_cents is not set' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assign_mp_lead', 0));

  for v_agent in
    select s.agent_id
      from agent_lead_settings s
      left join lateral (
        select count(*) filter (where l.created_at >= v_day_start) as today,
               max(l.created_at) as last_at
          from agent_balance_ledger l
         where l.agent_id = s.agent_id and l.kind = 'lead_charge'
      ) c on true
     where s.active
       and exists (select 1 from unnest(s.states) st where upper(btrim(st)) = v_state)
       and (s.daily_cap is null or c.today < s.daily_cap)
     order by c.last_at asc nulls first, s.agent_id
  loop
    perform agent_balance_lock(v_agent);
    select coalesce(sum(amount_cents), 0) into v_balance
      from agent_balance_ledger where agent_id = v_agent;
    if v_balance >= v_price then
      insert into agent_balance_ledger (agent_id, kind, amount_cents, lead_id)
      values (v_agent, 'lead_charge', -v_price, p_lead_id);
      update mp_leads set assigned_agent_id = v_agent where id = p_lead_id;
      return v_agent;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.assign_mp_lead(uuid) from public, anon, authenticated;
grant  execute on function public.assign_mp_lead(uuid) to service_role;

-- ── top-ups ─────────────────────────────────────────────────────────────────
-- Called by the Stripe webhook (service role) once a Checkout session is paid.
-- Idempotent on session_id: a replay returns the existing row's id. A replay
-- with a different agent or amount is refused rather than silently ignored.
create or replace function public.credit_topup(p_agent_id uuid, p_cents integer, p_session_id text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_id       uuid;
  v_existing record;
begin
  if p_agent_id is null then
    raise exception 'agent_id is required' using errcode = '22004';
  end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'cents must be a positive whole number' using errcode = '22023';
  end if;
  if p_session_id is null or btrim(p_session_id) = '' then
    raise exception 'session_id is required' using errcode = '22004';
  end if;
  if not exists (select 1 from profiles where id = p_agent_id) then
    raise exception 'Agent % not found', p_agent_id using errcode = 'P0002';
  end if;

  insert into agent_balance_ledger (agent_id, kind, amount_cents, stripe_session_id)
  values (p_agent_id, 'topup', p_cents, p_session_id)
  on conflict (stripe_session_id) where kind = 'topup' do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select id, agent_id, amount_cents into v_existing
    from agent_balance_ledger
   where kind = 'topup' and stripe_session_id = p_session_id;
  if v_existing.agent_id <> p_agent_id or v_existing.amount_cents <> p_cents then
    raise exception 'Session % was already credited with different details', p_session_id
      using errcode = '23505';
  end if;
  return v_existing.id;
end;
$$;

revoke execute on function public.credit_topup(uuid, integer, text) from public, anon, authenticated;
grant  execute on function public.credit_topup(uuid, integer, text) to service_role;

-- Check after applying (expect anon=false, authenticated=false, service_role=true):
--   select f, r, has_function_privilege(r, f, 'execute')
--     from unnest(array['public.assign_mp_lead(uuid)', 'public.credit_topup(uuid,integer,text)']) f,
--          unnest(array['anon', 'authenticated', 'service_role']) r;
--   select r, has_table_privilege(r, 'public.agent_balance_ledger', 'insert,update,delete')
--     from unnest(array['anon', 'authenticated']) r;   -- expect false
