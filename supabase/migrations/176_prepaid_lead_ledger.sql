-- 176 — Prepaid lead ledger: balance, charge_lead, credit_topup, lead prices
-- and top-up options (Roadmap Goal 3).
--
-- Needs migration 166 first (166_lead_types_delivery: leads.lead_type). The
-- check below stops the whole file if it is missing.
--
-- NOT APPLIED. Money code: written from a worktree; applying it is a separate,
-- checked step through Brayden's door. Additive only: new tables, one view,
-- functions, triggers, indexes and policies. Nothing existing is dropped,
-- altered, renamed or deleted.
--
-- SUPERSEDED, never to be merged or applied (each was a rival design for this
-- same ledger; this file is the one ledger):
--   162_agent_balance_ledger   (branch atlas/b2b96152, on the old Meta-only table)
--   163_agent_balance_ledger   (branch atlas/9f624389)
--   169_prepaid_lead_balance   (branch atlas/7afb4166)
--   171_charge_lead_on_leads   (branch atlas/e1fb868b)
-- None was ever applied, so none of their objects exist; this file creates its
-- own and stops if any of its names is already taken.
--
-- Agents top up a prepaid balance (Stripe Checkout) and each typed lead
-- delivered to them is charged from it. Cancellation billing
-- (recovery_config.pay_per_cancel_cents, 145) is a separate system and is not
-- read or changed here; a 'cancellation' lead is never priced or charged.
--
--   agent_lead_ledger      one row per money movement, signed integer cents:
--                            topup   > 0, stripe_session_id required
--                            charge  < 0, lead_id + lead_type required
--                            adjust  either sign (a correction; no function
--                                    writes it yet, so only the door can)
--                          Append-only: a trigger refuses UPDATE, DELETE and
--                          TRUNCATE for everyone. balance_after_cents is set
--                          by a trigger under the agent's lock and can never
--                          be below 0 (CHECK), whichever path inserted the row.
--   agent_lead_balance     view: agent_id, balance_cents = sum of the agent's
--                          ledger rows. An agent with no rows has no row (0).
--   lead_prices            lead_type → price_cents. Seeded from the Pricing.md
--                          proposal (NOT decided; editable defaults).
--   prepaid_topup_options  the top-up amounts an agent can pick. Seeded from
--                          the unmerged top-up code (NOT decided; editable
--                          defaults).
--   charge_lead(lead_id)   service role only. Charges the lead's assigned
--                          agent the active price for its lead_type, once.
--   credit_topup(...)      service role only. Credits one paid Stripe top-up,
--                          once per session id and once per event id.
--
-- Locking: every ledger insert takes a per-agent transaction advisory lock
-- (agent_lead_ledger_agent_lock), so two inserts for one agent run one after
-- another and each sees the other's row. charge_lead locks the lead row first
-- (FOR UPDATE), then the agent: always lead → agent, so no lock cycles. Two
-- sessions charging the same lead: the second waits on the lead row, then
-- finds the charge and returns 'already_charged'.
--
-- RLS: an agent reads only their own ledger rows (and so only their own
-- balance row, the view runs as the caller); admin reads all. No insert,
-- update or delete policy and no write grant for anon, authenticated or the
-- service role: the two functions (owner rights) are the only writers.
-- Prices and top-up options: agents read the active rows, admin reads all,
-- nobody writes through the API (changed by Brayden's door).

-- ── preconditions ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type') then
    raise exception '176 needs migration 166 (leads.lead_type) applied first';
  end if;
  if to_regclass('public.agent_lead_ledger') is not null
     or to_regclass('public.agent_lead_balance') is not null
     or to_regclass('public.lead_prices') is not null
     or to_regclass('public.prepaid_topup_options') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('charge_lead', 'credit_topup')) then
    raise exception '176: a ledger object already exists (a superseded 162/163/169/171 applied?); stop and ask';
  end if;
end $$;

-- ── prices ──────────────────────────────────────────────────────────────────
-- Keys are the typed leads.lead_type values from 166. 'cancellation' is left
-- out on purpose: cancellations keep their own billing.
create table public.lead_prices (
  lead_type    text primary key
                 check (lead_type in ('mortgage_protection', 'policy_help', 'policy_review')),
  price_cents  integer not null check (price_cents > 0),
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Pricing.md proposal, NOT decided: Meta lead $30, Google call $55.
insert into public.lead_prices (lead_type, price_cents) values
  ('mortgage_protection', 3000),   -- Meta lead (/protect)
  ('policy_help',         5500);   -- Google call

alter table public.lead_prices enable row level security;
create policy lead_prices_read on public.lead_prices
  for select to authenticated using (active or public.is_admin());
revoke all on public.lead_prices from public, anon, authenticated;
grant select on public.lead_prices to authenticated, service_role;

-- ── top-up options ──────────────────────────────────────────────────────────
create table public.prepaid_topup_options (
  amount_cents  integer primary key check (amount_cents > 0),
  sort          integer not null default 0,
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- From the unmerged lead-balance-topup code, NOT decided: $100, $250, $500.
insert into public.prepaid_topup_options (amount_cents, sort) values
  (10000, 1),
  (25000, 2),
  (50000, 3);

alter table public.prepaid_topup_options enable row level security;
create policy prepaid_topup_options_read on public.prepaid_topup_options
  for select to authenticated using (active or public.is_admin());
revoke all on public.prepaid_topup_options from public, anon, authenticated;
grant select on public.prepaid_topup_options to authenticated, service_role;

-- ── ledger ──────────────────────────────────────────────────────────────────
create table public.agent_lead_ledger (
  id                   uuid primary key default gen_random_uuid(),
  -- A record of money: the profile can't be deleted out from under it.
  agent_id             uuid not null references public.profiles(id) on delete restrict,
  kind                 text not null check (kind in ('topup', 'charge', 'adjust')),
  amount_cents         integer not null check (amount_cents <> 0),
  balance_after_cents  bigint not null check (balance_after_cents >= 0),
  -- A charged lead can't be deleted out from under its charge.
  lead_id              uuid references public.leads(id) on delete restrict,
  lead_type            text,
  stripe_session_id    text check (stripe_session_id is null or length(btrim(stripe_session_id)) between 1 and 255),
  stripe_event_id      text check (stripe_event_id is null or length(btrim(stripe_event_id)) between 1 and 255),
  note                 text check (note is null or length(note) <= 200),
  created_at           timestamptz not null default now(),
  constraint agent_lead_ledger_topup_shape
    check (kind <> 'topup' or (amount_cents > 0 and stripe_session_id is not null and lead_id is null)),
  constraint agent_lead_ledger_charge_shape
    check (kind <> 'charge' or (amount_cents < 0 and lead_id is not null and lead_type is not null
                                and stripe_session_id is null and stripe_event_id is null))
);

-- Each lead is charged once.
create unique index agent_lead_ledger_one_charge_per_lead
  on public.agent_lead_ledger (lead_id) where kind = 'charge';
-- A replayed or retried webhook credits once: per Checkout Session and per event.
create unique index agent_lead_ledger_one_topup_per_session
  on public.agent_lead_ledger (stripe_session_id) where kind = 'topup';
create unique index agent_lead_ledger_one_topup_per_event
  on public.agent_lead_ledger (stripe_event_id) where kind = 'topup';
-- Billing history and the balance sum.
create index agent_lead_ledger_agent_time
  on public.agent_lead_ledger (agent_id, created_at desc);

alter table public.agent_lead_ledger enable row level security;
create policy agent_lead_ledger_read on public.agent_lead_ledger
  for select to authenticated using (agent_id = auth.uid() or public.is_admin());
-- No insert / update / delete policy, and no write grant to anyone: only
-- charge_lead and credit_topup (security definer, owner rights) insert.
revoke all on public.agent_lead_ledger from public, anon, authenticated, service_role;
grant select on public.agent_lead_ledger to authenticated, service_role;

-- The per-agent lock every ledger insert takes (re-entrant in a transaction).
create function public.agent_lead_ledger_agent_lock(p_agent_id uuid)
 returns void
 language sql
 set search_path to 'public'
as $$
  select pg_advisory_xact_lock(hashtextextended('agent_lead_ledger:' || p_agent_id::text, 0));
$$;

-- Append-only: no UPDATE / DELETE / TRUNCATE, whoever asks.
create function public.agent_lead_ledger_block_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  raise exception 'agent_lead_ledger is append-only (% not allowed); add an adjust row instead', tg_op
    using errcode = '42501';
end;
$$;

create trigger agent_lead_ledger_no_update_delete
  before update or delete on public.agent_lead_ledger
  for each row execute function public.agent_lead_ledger_block_change();
create trigger agent_lead_ledger_no_truncate
  before truncate on public.agent_lead_ledger
  for each statement execute function public.agent_lead_ledger_block_change();

-- Every insert: lock the agent, set the running balance from the live sum (a
-- client value is ignored) and stamp the time. A row that would take the agent
-- below 0 fails the balance_after_cents CHECK, whatever path inserted it.
create function public.agent_lead_ledger_before_insert()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
declare
  v_balance bigint;
begin
  perform agent_lead_ledger_agent_lock(new.agent_id);
  select coalesce(sum(amount_cents), 0) into v_balance
    from agent_lead_ledger where agent_id = new.agent_id;
  new.balance_after_cents := v_balance + new.amount_cents;
  new.created_at := now();
  return new;
end;
$$;

create trigger agent_lead_ledger_before_insert
  before insert on public.agent_lead_ledger
  for each row execute function public.agent_lead_ledger_before_insert();

revoke execute on function public.agent_lead_ledger_agent_lock(uuid)  from public, anon, authenticated;
revoke execute on function public.agent_lead_ledger_block_change()    from public, anon, authenticated;
revoke execute on function public.agent_lead_ledger_before_insert()   from public, anon, authenticated;
grant  execute on function public.agent_lead_ledger_agent_lock(uuid)  to service_role;

-- ── balance ─────────────────────────────────────────────────────────────────
-- security_invoker: the ledger's RLS applies, so an agent sees only their own
-- row, admin sees all, anon nothing. Display only; every debit re-reads the
-- live sum under the agent lock.
create view public.agent_lead_balance
  with (security_invoker = true) as
  select agent_id, sum(amount_cents)::bigint as balance_cents
    from public.agent_lead_ledger
   group by agent_id;

revoke all on public.agent_lead_balance from public, anon, authenticated, service_role;
grant select on public.agent_lead_balance to authenticated, service_role;

-- ── charge_lead ─────────────────────────────────────────────────────────────
-- Charges the lead's assigned agent the active price for its lead_type, in
-- one transaction. Safe to call any number of times.
--
-- result:
--   charged          one 'charge' row was written now
--   already_charged  this lead was charged before; that row is returned, nothing written
--   no_agent         the lead has no assigned agent; nothing written
--   no_price         no active price for this lead_type (always for
--                    'cancellation'); nothing written
--   insufficient     the agent's balance is below the price; nothing written
-- Raises only on a bad call (null id, unknown lead).
create function public.charge_lead(p_lead_id uuid)
 returns table (result text, ledger_id uuid, charged_cents integer, balance_cents bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
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
  select l.assigned_rep_id, l.lead_type into v_agent, v_type
    from leads l where l.id = p_lead_id
    for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;

  select g.id, g.amount_cents, g.balance_after_cents into v_row
    from agent_lead_ledger g
   where g.lead_id = p_lead_id and g.kind = 'charge';
  if found then
    return query select 'already_charged'::text, v_row.id, -v_row.amount_cents, v_row.balance_after_cents;
    return;
  end if;

  if v_agent is null then
    return query select 'no_agent'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

  select p.price_cents into v_price
    from lead_prices p
   where p.lead_type = v_type and p.active;
  if v_price is null or v_type = 'cancellation' then
    return query select 'no_price'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

  perform agent_lead_ledger_agent_lock(v_agent);
  select coalesce(sum(g.amount_cents), 0) into v_balance
    from agent_lead_ledger g where g.agent_id = v_agent;
  if v_balance < v_price then
    return query select 'insufficient'::text, null::uuid, v_price, v_balance;
    return;
  end if;

  insert into agent_lead_ledger as g (agent_id, kind, amount_cents, balance_after_cents, lead_id, lead_type)
  values (v_agent, 'charge', -v_price, 0, p_lead_id, v_type)
  on conflict (lead_id) where kind = 'charge' do nothing
  returning g.id, g.balance_after_cents into v_id, v_after;

  if v_id is null then
    -- Unreachable under the lead lock; kept so a race can never double-charge.
    select g.id, g.amount_cents, g.balance_after_cents into v_row
      from agent_lead_ledger g
     where g.lead_id = p_lead_id and g.kind = 'charge';
    return query select 'already_charged'::text, v_row.id, -v_row.amount_cents, v_row.balance_after_cents;
    return;
  end if;

  return query select 'charged'::text, v_id, v_price, v_after;
end;
$$;

revoke execute on function public.charge_lead(uuid) from public, anon, authenticated;
grant  execute on function public.charge_lead(uuid) to service_role;

-- ── credit_topup ────────────────────────────────────────────────────────────
-- Credits one paid Stripe top-up (the webhook calls this once Checkout says
-- the session is paid).
--
-- result:
--   credited   one 'topup' row was written now
--   duplicate  this session id or event id was already credited; nothing written
-- Raises on a bad call (no agent, unknown agent, amount not > 0, no session
-- id), so the webhook answers non-2xx and the event shows as failed in Stripe.
-- The amount is what Stripe charged; prepaid_topup_options limits what the
-- agent can pick at checkout, not what is credited here.
create function public.credit_topup(
  p_agent_id          uuid,
  p_amount_cents      integer,
  p_stripe_session_id text,
  p_stripe_event_id   text,
  p_note              text default null
)
 returns table (result text, ledger_id uuid, balance_cents bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_session text := nullif(btrim(p_stripe_session_id), '');
  v_event   text := nullif(btrim(p_stripe_event_id), '');
  v_id      uuid;
  v_after   bigint;
begin
  if p_agent_id is null then
    raise exception 'credit_topup: agent_id is required' using errcode = '22004';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'credit_topup: amount must be more than 0 cents (got %)', p_amount_cents using errcode = '22023';
  end if;
  if v_session is null then
    raise exception 'credit_topup: stripe_session_id is required' using errcode = '22004';
  end if;
  if not exists (select 1 from profiles where id = p_agent_id) then
    raise exception 'credit_topup: profile % not found', p_agent_id using errcode = 'P0002';
  end if;

  perform agent_lead_ledger_agent_lock(p_agent_id);

  if exists (select 1 from agent_lead_ledger g
              where g.kind = 'topup'
                and (g.stripe_session_id = v_session or (v_event is not null and g.stripe_event_id = v_event))) then
    return query select 'duplicate'::text, null::uuid, null::bigint;
    return;
  end if;

  -- No conflict target: both partial unique indexes are arbiters, so a replay
  -- racing in from another agent's lock still writes nothing.
  insert into agent_lead_ledger as g (agent_id, kind, amount_cents, balance_after_cents,
                                      stripe_session_id, stripe_event_id, note)
  values (p_agent_id, 'topup', p_amount_cents, 0, v_session, v_event, p_note)
  on conflict do nothing
  returning g.id, g.balance_after_cents into v_id, v_after;

  if v_id is null then
    return query select 'duplicate'::text, null::uuid, null::bigint;
    return;
  end if;

  return query select 'credited'::text, v_id, v_after;
end;
$$;

revoke execute on function public.credit_topup(uuid, integer, text, text, text) from public, anon, authenticated;
grant  execute on function public.credit_topup(uuid, integer, text, text, text) to service_role;

-- Check after applying:
--   select f, r, has_function_privilege(r, f, 'execute')            -- expect only service_role true
--     from unnest(array['public.charge_lead(uuid)',
--                       'public.credit_topup(uuid,integer,text,text,text)']) f,
--          unnest(array['anon', 'authenticated', 'service_role']) r;
--   select r, has_table_privilege(r, 'public.agent_lead_ledger', 'insert,update,delete')
--     from unnest(array['anon', 'authenticated', 'service_role']) r; -- expect all false
--   select policyname, cmd from pg_policies
--    where tablename in ('agent_lead_ledger', 'lead_prices', 'prepaid_topup_options');
--                                                                    -- expect SELECT only
--   select * from lead_prices;            -- mortgage_protection 3000, policy_help 5500
--   select * from prepaid_topup_options;  -- 10000, 25000, 50000
