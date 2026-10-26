-- 161 — Prepaid balance: Stripe top-ups credit an agent's ledger.
--
-- An agent buys a set amount ($100 / $250 / $500) with a one-time Stripe
-- Checkout (create-balance-topup). When Stripe says the session is paid, the
-- agent-billing webhook calls credit_topup(agent, amount, session id). One row
-- per Checkout Session: the unique stripe_session_id makes a repeated or
-- retried webhook a no-op, so a session is credited exactly once.
--
-- The balance is the sum of an agent's rows. Only top-ups exist so far (no
-- spend path yet); later kinds (spend, refund, adjustment) go in the same
-- table with their own sign.
--
-- Clients can read their own rows and never write: every write goes through
-- credit_topup, which only the service role may call.

create table if not exists public.agent_balance_ledger (
  id                uuid primary key default gen_random_uuid(),
  -- Kept if the profile is ever deleted: it's a record of money received.
  agent_id          uuid references public.profiles(id) on delete set null,
  kind              text not null check (kind in ('topup')),
  amount_cents      integer not null check (amount_cents <> 0),
  currency          text not null default 'usd',
  stripe_session_id text unique,
  created_at        timestamptz not null default now(),
  constraint agent_balance_ledger_topup_shape check (
    kind <> 'topup' or (amount_cents > 0 and stripe_session_id is not null)
  )
);
create index if not exists agent_balance_ledger_agent_idx on public.agent_balance_ledger (agent_id, created_at desc);

alter table public.agent_balance_ledger enable row level security;
revoke all on public.agent_balance_ledger from anon, authenticated;
grant select on public.agent_balance_ledger to authenticated;
drop policy if exists agent_balance_ledger_own_read on public.agent_balance_ledger;
create policy agent_balance_ledger_own_read on public.agent_balance_ledger
  for select to authenticated using (agent_id = auth.uid());

-- Credit one paid top-up. Returns true if this call credited it, false if the
-- session was already credited. Raises on anything that shouldn't be credited
-- (not an agent, an amount that isn't one of the set ones), so the webhook
-- answers non-2xx and the event shows up as failed in Stripe.
-- Keep the amounts in step with supabase/functions/_shared/balanceTopup.ts.
create or replace function public.credit_topup(p_agent uuid, p_amount_cents integer, p_session text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  if p_session is null or btrim(p_session) = '' then
    raise exception 'credit_topup: session id is required' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents not in (10000, 25000, 50000) then
    raise exception 'credit_topup: % is not a top-up amount', p_amount_cents using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_agent and role = 'agent') then
    raise exception 'credit_topup: % is not an agent', p_agent using errcode = 'P0002';
  end if;
  insert into agent_balance_ledger (agent_id, kind, amount_cents, stripe_session_id)
  values (p_agent, 'topup', p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.credit_topup(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.credit_topup(uuid, integer, text) to service_role;
