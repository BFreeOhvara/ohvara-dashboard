-- 171 — Prepaid lead charge moves from mp_leads to leads.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Apply after 166_lead_types_delivery (leads.lead_type) and
-- 169_prepaid_lead_balance (agent_lead_ledger, charge_lead).
--
-- lead-intake writes every inbound lead into leads (lead_type
-- 'mortgage_protection', …), so leads is the one table a lead lives in and the
-- one table it is charged against. 169 pointed agent_lead_ledger.lead_id and
-- charge_lead at mp_leads; this moves both to leads:
--
--   agent_lead_ledger.lead_id   now references leads(id), on delete restrict:
--                               a charged lead can't be deleted out from under
--                               its ledger row. Adding the key checks every
--                               existing row, so if any lead_charge row points
--                               at an mp_leads id the whole migration stops
--                               and nothing changes (169 isn't applied yet, so
--                               there should be none).
--   charge_lead(lead_id)        reads leads.assigned_rep_id and leads.lead_type.
--                               Same results and same return shape as 169.
--   price_per_lead_cents        may not price 'cancellation'. Cancellation
--                               billing (recovery_config.pay_per_cancel_cents,
--                               145) is its own system; charge_lead never
--                               charges a cancellation lead, whatever the map
--                               says.
--
-- mp_leads is not dropped, changed or emptied. Nothing else is dropped: only
-- the ledger's old foreign key and the price check are replaced.

-- ── ledger → leads ──────────────────────────────────────────────────────────
alter table public.agent_lead_ledger drop constraint if exists agent_lead_ledger_lead_id_fkey;
alter table public.agent_lead_ledger add constraint agent_lead_ledger_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete restrict;

-- ── price: never for cancellation leads ─────────────────────────────────────
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
               when e.key = 'cancellation' then true
               when jsonb_typeof(e.value) <> 'number' then true
               else (e.value)::numeric <> trunc((e.value)::numeric)
                 or (e.value)::numeric not between 1 and 100000
             end
    )
  );
$$;

-- Re-added so the stricter rule is checked against the current value too.
alter table public.recovery_config drop constraint if exists recovery_config_price_per_lead_check;
alter table public.recovery_config add constraint recovery_config_price_per_lead_check
  check (public.lead_price_map_ok(price_per_lead_cents));

-- ── charge_lead on leads ────────────────────────────────────────────────────
-- result (unchanged from 169):
--   charged          a lead_charge row was written now
--   already_charged  this lead was charged before; that row is returned
--   no_price         no price for this lead_type (or a cancellation lead)
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
    from leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;

  select l.id, l.agent_id, l.amount_cents, l.balance_after_cents into v_row
    from agent_lead_ledger l
   where l.lead_id = p_lead_id and l.kind = 'lead_charge';
  if found then
    return query select 'already_charged'::text, v_row.id, -v_row.amount_cents, v_row.balance_after_cents;
    return;
  end if;

  if v_agent is null then
    return query select 'no_agent'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

  if v_type is null or v_type = 'cancellation' then
    return query select 'no_price'::text, null::uuid, null::integer, null::bigint;
    return;
  end if;

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
--   select confrelid::regclass from pg_constraint
--    where conname = 'agent_lead_ledger_lead_id_fkey';               -- expect leads
--   select r, has_function_privilege(r, 'public.charge_lead(uuid)', 'execute')
--     from unnest(array['anon', 'authenticated', 'service_role']) r; -- only service_role true
--   select public.lead_price_map_ok('{"cancellation": 500}');        -- expect false
--   select count(*) from mp_leads;                                    -- same as before
