-- 162 — Prepaid lead balance: ledger, balance view, per-type lead price,
-- charge_lead.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one new table, one view, one recovery_config column,
-- functions and triggers. Nothing is dropped, renamed or deleted.
--
-- Agents top up a prepaid balance (Stripe) and each lead delivered to them is
-- charged from it. The balance is never stored on its own: it is the sum of
-- the agent's agent_lead_ledger rows. The ledger is append-only; a correction
-- is a new 'refund' or 'adjustment' row, never an edit.
--
--   agent_lead_ledger        one row per money movement, signed cents:
--                              topup        > 0, stripe_ref required (one per ref)
--                              lead_charge  < 0, lead_id required (one per lead)
--                              refund       > 0
--                              adjustment   either sign
--                            balance_after_cents is set by a trigger under the
--                            agent's lock (the running balance the Billing
--                            history shows); a client value is ignored.
--   agent_lead_balance       view: agent_id, balance_cents = sum of the rows.
--   recovery_config          price_per_lead_cents: jsonb map lead_type → cents,
--                            e.g. {"mortgage_protection": <cents>}. Null by
--                            default, so nothing is charged until an admin
--                            sets a price. A type missing from the map is not
--                            charged either.
--   charge_lead(lead_id)     service role only. Charges the lead's assigned
--                            agent the price for its lead_type, once.
--
-- Cancellation billing (recovery_config.pay_per_cancel_cents, migration 145,
-- fulfillment_cancels) is a separate system and is not read or changed here.
--
-- RLS: an agent reads only their own ledger rows (and so only their own
-- balance row through the view). anon reads nothing. Nobody but the service
-- role writes, and the service role may only INSERT: UPDATE, DELETE and
-- TRUNCATE are refused by trigger for everyone.
--
-- Depends on mp_leads (id, assigned_agent_id) from the Meta leads migration.
-- lead_type on mp_leads is read if present; a lead without one counts as
-- 'mortgage_protection' (the only type mp_leads holds today).
--
-- Locking: charge_lead locks the lead row (FOR UPDATE), then the agent's
-- advisory lock. Every ledger insert takes the same agent lock in its trigger
-- (re-entrant within one transaction). Always lead → agent, so no cycles.

-- ── price ───────────────────────────────────────────────────────────────────
-- A price map is null, or an object of lead_type → whole cents, 1..100000.
create or replace function public.lead_price_map_ok(p jsonb)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) e
       where case
               when e.key !~ '^[a-z_]{1,40}$' then true
               when jsonb_typeof(e.value) <> 'number' then true
               else (e.value)::numeric <> trunc((e.value)::numeric)
                 or (e.value)::numeric not between 1 and 100000
             end
    )
  );
$$;

alter table public.recovery_config
  add column if not exists price_per_lead_cents jsonb;
alter table public.recovery_config drop constraint if exists recovery_config_price_per_lead_check;
alter table public.recovery_config add constraint recovery_config_price_per_lead_check
  check (public.lead_price_map_ok(price_per_lead_cents));
-- The recovery_config_admin_update policy (122) limits this to admins.
grant update (price_per_lead_cents) on public.recovery_config to authenticated;

-- ── ledger ──────────────────────────────────────────────────────────────────
create table if not exists public.agent_lead_ledger (
  id                   uuid primary key default gen_random_uuid(),
  -- A record of money: the profile can't be deleted out from under it.
  agent_id             uuid not null references public.profiles(id) on delete restrict,
  amount_cents         integer not null check (amount_cents <> 0),
  kind                 text not null check (kind in ('topup', 'lead_charge', 'refund', 'adjustment')),
  lead_id              uuid references public.mp_leads(id) on delete restrict,
  stripe_ref           text check (stripe_ref is null or length(btrim(stripe_ref)) between 1 and 255),
  note                 text check (note is null or length(note) <= 200),
  balance_after_cents  bigint not null default 0,
  created_at           timestamptz not null default now(),
  constraint agent_lead_ledger_topup_shape
    check (kind <> 'topup' or (amount_cents > 0 and stripe_ref is not null)),
  constraint agent_lead_ledger_charge_shape
    check (kind <> 'lead_charge' or (amount_cents < 0 and lead_id is not null)),
  constraint agent_lead_ledger_refund_shape
    check (kind <> 'refund' or amount_cents > 0)
);

create unique index if not exists agent_lead_ledger_one_charge_per_lead
  on public.agent_lead_ledger (lead_id) where kind = 'lead_charge';
create unique index if not exists agent_lead_ledger_one_topup_per_ref
  on public.agent_lead_ledger (stripe_ref) where kind = 'topup';
create index if not exists agent_lead_ledger_agent_time
  on public.agent_lead_ledger (agent_id, created_at desc);

alter table public.agent_lead_ledger enable row level security;

drop policy if exists agent_lead_ledger_own_read on public.agent_lead_ledger;
create policy agent_lead_ledger_own_read on public.agent_lead_ledger
  for select to authenticated using (agent_id = auth.uid());

revoke all on public.agent_lead_ledger from public, anon, authenticated, service_role;
grant select on public.agent_lead_ledger to authenticated;
grant select, insert on public.agent_lead_ledger to service_role;

-- The per-agent lock every ledger insert takes. Shared with charge_lead.
create or replace function public.agent_lead_ledger_lock(p_agent_id uuid)
 returns void
 language sql
 set search_path to 'public'
as $$
  select pg_advisory_xact_lock(hashtextextended('agent_lead_ledger:' || p_agent_id::text, 0));
$$;

-- Append-only: no UPDATE / DELETE / TRUNCATE, whoever asks.
create or replace function public.agent_lead_ledger_block_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  raise exception 'agent_lead_ledger is append-only (% not allowed); add a refund or adjustment row instead', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists agent_lead_ledger_no_update_delete on public.agent_lead_ledger;
create trigger agent_lead_ledger_no_update_delete
  before update or delete on public.agent_lead_ledger
  for each row execute function public.agent_lead_ledger_block_change();
drop trigger if exists agent_lead_ledger_no_truncate on public.agent_lead_ledger;
create trigger agent_lead_ledger_no_truncate
  before truncate on public.agent_lead_ledger
  for each statement execute function public.agent_lead_ledger_block_change();

-- Every insert: lock the agent, set the running balance, and refuse any
-- negative row that would take the agent below 0 (whatever path inserted it).
create or replace function public.agent_lead_ledger_before_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_balance bigint;
begin
  perform agent_lead_ledger_lock(new.agent_id);
  select coalesce(sum(amount_cents), 0) into v_balance
    from agent_lead_ledger where agent_id = new.agent_id;
  if new.amount_cents < 0 and v_balance + new.amount_cents < 0 then
    raise exception 'Insufficient balance: % cents available, % needed', v_balance, -new.amount_cents
      using errcode = '23514';
  end if;
  new.balance_after_cents := v_balance + new.amount_cents;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists agent_lead_ledger_before_insert on public.agent_lead_ledger;
create trigger agent_lead_ledger_before_insert
  before insert on public.agent_lead_ledger
  for each row execute function public.agent_lead_ledger_before_insert();

revoke execute on function public.agent_lead_ledger_block_change()  from public, anon, authenticated;
revoke execute on function public.agent_lead_ledger_before_insert() from public, anon, authenticated;
revoke execute on function public.agent_lead_ledger_lock(uuid)      from public, anon, authenticated;
grant  execute on function public.agent_lead_ledger_lock(uuid)      to service_role;

-- ── balance view ────────────────────────────────────────────────────────────
-- security_invoker: the ledger's RLS applies, so an agent sees only their own
-- row and anon sees nothing. An agent with no rows has no row (balance 0).
-- Display only; every debit re-checks the live sum under the agent lock.
create or replace view public.agent_lead_balance
  with (security_invoker = true) as
  select agent_id, sum(amount_cents)::bigint as balance_cents
    from public.agent_lead_ledger
   group by agent_id;

revoke all on public.agent_lead_balance from public, anon, authenticated, service_role;
grant select on public.agent_lead_balance to authenticated, service_role;

-- ── charge_lead ─────────────────────────────────────────────────────────────
-- Charges the lead's assigned agent the price for its lead_type, in one
-- transaction. Safe to call any number of times: a lead is charged at most
-- once (lead row lock + unique index), and a repeat returns the first charge.
--
-- result:
--   charged          a lead_charge row was written now
--   already_charged  this lead was charged before; that row is returned
--   no_price         no price set for this lead_type; nothing written
--   insufficient     the agent's balance is below the price; nothing written
--   no_agent         the lead has no assigned agent; nothing written
-- Raises only on a bad call (null id, unknown lead).
create or replace function public.charge_lead(p_lead_id uuid)
 returns table (result text, ledger_id uuid, charged_cents integer, balance_cents bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_lead    jsonb;
  v_agent   uuid;
  v_type    text;
  v_price   integer;
  v_balance bigint;
  v_row     record;
  v_id      uuid;
  v_after   bigint;
begin
  if p_lead_id is null then
    raise exception 'lead_id is required' using errcode = '22004';
  end if;

  -- Lock the lead: concurrent calls for the same lead run one after another.
  -- to_jsonb so lead_type is read when the column exists, without needing it.
  select to_jsonb(l) into v_lead from mp_leads l where l.id = p_lead_id for update;
  if v_lead is null then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;

  select l.id, l.agent_id, l.amount_cents, l.balance_after_cents into v_row
    from agent_lead_ledger l
   where l.lead_id = p_lead_id and l.kind = 'lead_charge';
  if found then
    return query select 'already_charged'::text, v_row.id, -v_row.amount_cents, v_row.balance_after_cents;
    return;
  end if;

  v_agent := nullif(v_lead ->> 'assigned_agent_id', '')::uuid;
  if v_agent is null then
    return query select 'no_agent'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

  v_type := coalesce(nullif(btrim(v_lead ->> 'lead_type'), ''), 'mortgage_protection');
  select (c.price_per_lead_cents -> v_type)::numeric::integer into v_price
    from recovery_config c where c.id;
  if v_price is null or v_price <= 0 then
    return query select 'no_price'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

  perform agent_lead_ledger_lock(v_agent);
  select coalesce(sum(l.amount_cents), 0) into v_balance
    from agent_lead_ledger l where l.agent_id = v_agent;
  if v_balance < v_price then
    return query select 'insufficient'::text, null::uuid, v_price, v_balance;
    return;
  end if;

  insert into agent_lead_ledger as l (agent_id, kind, amount_cents, lead_id)
  values (v_agent, 'lead_charge', -v_price, p_lead_id)
  on conflict (lead_id) where kind = 'lead_charge' do nothing
  returning l.id, l.balance_after_cents into v_id, v_after;

  if v_id is null then
    -- Unreachable under the lead lock; kept so a race can never double-charge.
    select l.id, l.amount_cents, l.balance_after_cents into v_row
      from agent_lead_ledger l
     where l.lead_id = p_lead_id and l.kind = 'lead_charge';
    return query select 'already_charged'::text, v_row.id, -v_row.amount_cents, v_row.balance_after_cents;
    return;
  end if;

  return query select 'charged'::text, v_id, v_price, v_after;
end;
$$;

revoke execute on function public.charge_lead(uuid) from public, anon, authenticated;
grant  execute on function public.charge_lead(uuid) to service_role;

-- Check after applying:
--   select f, r, has_function_privilege(r, f, 'execute')       -- expect only service_role true
--     from unnest(array['public.charge_lead(uuid)']) f,
--          unnest(array['anon', 'authenticated', 'service_role']) r;
--   select r, has_table_privilege(r, 'public.agent_lead_ledger', 'insert,update,delete')
--     from unnest(array['anon', 'authenticated']) r;              -- expect false
--   select price_per_lead_cents from recovery_config;              -- expect null
