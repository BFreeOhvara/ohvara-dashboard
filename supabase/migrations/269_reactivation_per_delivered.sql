-- 269_reactivation_per_delivered (Prompt 957, Brayden Nov 11 11:57-12:02). NOT APPLIED until Brayden's yes.
--
-- Reactivation's final model: uploading a list is FREE; every DELIVERED appointment or live call costs $20 (admin
-- setting). "$2 a lead earns the same whether we book 5 or 75." And nobody can get leads without paying:
--
--   * A card check before a list starts (lead-spend 'reactivation_start'): the default card must not be prepaid, its
--     fingerprint can't already back another account, and a $1 hold must go through (3-D Secure when the bank asks;
--     Stripe Radar runs on it). The hold is released at once. reactivation_card_* below keep the result.
--   * Pay before you see the lead: a booking or a connected live transfer makes a delivery (reactivation_deliveries)
--     and a $20 charge (kind 'reactivation_delivery', OHVARA LEADS). The lead stays hidden (267's restrictive policy:
--     reactivated_at is null) until that charge is PAID; then the name and number show on the agent's board.
--     A booking is charged at once; a live transfer once it has been connected for transfer_min_secs (30 s). A transfer
--     reported shorter than that is free (or refunded if it was already charged).
--   * A declined charge pauses every list of that agent at once (pause_kind 'card'); fixing the card retries the charge
--     (lead-spend pay_now) and a paid charge resumes the lists. A live transfer still completes that one time.
--   * New accounts: up to new_max_callable (300) people being called and new_daily_calls a day until new_until_paid (3)
--     deliveries are paid. The same number uploaded by two accounts is flagged. Admin sees calls vs paid deliveries per
--     account; lots of calls and nothing paid = a to-do.
--   * One charge per person: a no-show is rebooked by the AI for free (inbound_events 'no_show' → the person is called
--     again), and any later booking of an already-paid person is a free_rebook.
--   * Texts only after they book: no cold texts to imported people (carrier rules on purchased lists; Jordan's A2P).
--     After booking, the AI asks "Can I text you the confirmation?" (ai-caller tool text_ok). A yes is kept with the call
--     and queues the booking texts (confirmation + reminders) for that one person, sent from the reactivation pool by the
--     reactivation function while sms_live AND reactivation_live are on (both off today: the texts just wait, queued).
--
-- Rules mirrored in src/lib/reactivation.js. Doc: brain/ohvara/Reactivation.md. Tests: supabase/tests/p957_reactivation.sql.

do $$ begin
  if to_regclass('public.reactivation_lists') is null or to_regprocedure('public.billing_product_add(text, text, integer, uuid)') is null then
    raise exception '269 needs 267 and 268 applied first';
  end if;
end $$;

-- ── 1. Settings ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.reactivation_settings
  add column if not exists delivered_cents   int not null default 2000 check (delivered_cents between 100 and 20000),
  add column if not exists transfer_min_secs int not null default 30   check (transfer_min_secs between 5 and 300),
  add column if not exists new_until_paid    int not null default 3    check (new_until_paid between 0 and 50),
  add column if not exists new_max_callable  int not null default 300  check (new_max_callable between 10 and 5000),
  add column if not exists new_daily_calls   int not null default 100  check (new_daily_calls between 10 and 5000),
  add column if not exists max_callable      int not null default 5000 check (max_callable between 100 and 20000),
  add column if not exists daily_calls       int not null default 1000 check (daily_calls between 10 and 20000),
  add column if not exists watch_calls       int not null default 60   check (watch_calls between 10 and 5000);
comment on column public.reactivation_settings.delivered_cents is
  'P957: the price of one delivered appointment or live call. Uploading is free. (price_cents / min_leads are the retired P952 per-lead model.)';

-- ── 2. Card checks ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.reactivation_cards (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  pm_id       text,
  fingerprint text,
  funding     text,
  brand       text,
  last4       text,
  status      text not null check (status in ('ok', 'prepaid', 'declined', 'shared', 'needs_action', 'no_card')),
  failure     text check (char_length(failure) <= 300),
  checked_at  timestamptz not null default clock_timestamp()
);
create index if not exists reactivation_cards_agent_idx on public.reactivation_cards (agent_id, checked_at desc);
create index if not exists reactivation_cards_fp_idx on public.reactivation_cards (fingerprint) where fingerprint is not null;
alter table public.reactivation_cards enable row level security;
revoke all on public.reactivation_cards from public, anon, authenticated;
grant select on public.reactivation_cards to authenticated;
drop policy if exists reactivation_cards_admin on public.reactivation_cards;
create policy reactivation_cards_admin on public.reactivation_cards for select to authenticated using (public.is_admin());

-- Does this card already back ANOTHER account (a check that passed)? One card, one account.
create or replace function public.reactivation_card_shared(p_agent uuid, p_fingerprint text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_fingerprint, '') <> '' and exists (
    select 1 from reactivation_cards where fingerprint = p_fingerprint and agent_id <> p_agent and status = 'ok')
$$;

-- lead-spend reports one check. A shared card bells the admins.
create or replace function public.reactivation_card_record(p_agent uuid, p_pm text, p_fingerprint text, p_funding text,
  p_brand text, p_last4 text, p_status text, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare other text;
begin
  insert into reactivation_cards (agent_id, pm_id, fingerprint, funding, brand, last4, status, failure)
  values (p_agent, left(p_pm, 80), left(p_fingerprint, 80), left(p_funding, 20), left(p_brand, 20), left(p_last4, 4), p_status, left(p_failure, 300));
  if p_status = 'shared' then
    select string_agg(distinct coalesce(pr.full_name, 'an agent'), ', ') into other
      from reactivation_cards c join profiles pr on pr.id = c.agent_id
     where c.fingerprint = p_fingerprint and c.agent_id <> p_agent and c.status = 'ok';
    perform route_notify_admins('reactivation_watch', 'A card is on two reactivation accounts',
      coalesce((select full_name from profiles where id = p_agent), 'An agent') || ' tried to start a list with the same card as '
        || coalesce(other, 'another account') || '. Their list did not start.', '/admin/inbounds?view=reactivation',
      'reactivation_shared_card:' || p_agent || ':' || coalesce(p_fingerprint, ''));
  end if;
  return jsonb_build_object('ok', p_status = 'ok', 'code', p_status);
end;
$$;

-- A passed check in the last 15 minutes (lead-spend runs the check right before it starts the list).
create or replace function public.reactivation_card_ok(p_agent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'ok' and checked_at > now() - interval '15 minutes'
                     from reactivation_cards where agent_id = p_agent order by checked_at desc limit 1), false)
$$;
revoke execute on function public.reactivation_card_shared(uuid, text), public.reactivation_card_ok(uuid),
  public.reactivation_card_record(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;

-- ── 3. Lists and people ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.reactivation_lists
  add column if not exists model      text not null default 'per_lead' check (model in ('per_lead', 'per_delivered')),
  add column if not exists pause_kind text check (pause_kind in ('stop_rate', 'admin', 'card')),
  add column if not exists over_limit int not null default 0 check (over_limit >= 0),
  add column if not exists dupes      int not null default 0 check (dupes >= 0);
alter table public.reactivation_contacts
  add column if not exists dupe         boolean not null default false,
  add column if not exists text_ok      boolean,
  add column if not exists text_ok_at   timestamptz,
  add column if not exists text_ok_call uuid references public.ai_calls(id) on delete set null,
  add column if not exists rebook       boolean not null default false,
  add column if not exists rebook_tries int not null default 0 check (rebook_tries between 0 and 10);
update public.reactivation_lists set pause_kind = case when pause_reason = 'Paused by an admin' then 'admin' else 'stop_rate' end
 where status = 'paused' and pause_kind is null;

-- ── 4. Deliveries: the one thing an agent pays for ──────────────────────────────────────────────────────────────
create table if not exists public.reactivation_deliveries (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.reactivation_contacts(id) on delete cascade,
  list_id          uuid not null references public.reactivation_lists(id) on delete cascade,
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  call_id          uuid references public.ai_calls(id) on delete set null,
  kind             text not null check (kind in ('booked', 'transferred')),
  status           text not null default 'pending' check (status in ('pending', 'charging', 'paid', 'failed', 'free_rebook', 'short', 'refunded', 'waived')),
  amount_cents     int not null default 0 check (amount_cents >= 0),
  bill_after       timestamptz not null default now(),
  transfer_secs    int check (transfer_secs >= 0),
  charge_id        uuid references public.lead_spend_charges(id) on delete set null,
  paid_at          timestamptz,
  failed_at        timestamptz,
  failure          text check (char_length(failure) <= 300),
  refund_due_cents int not null default 0 check (refund_due_cents >= 0),
  refunded_cents   int not null default 0 check (refunded_cents >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- One charge per person: while a delivery is owed or paid, the same person can't be charged again.
create unique index if not exists reactivation_deliveries_once on public.reactivation_deliveries (contact_id)
  where status in ('pending', 'charging', 'paid', 'failed');
create index if not exists reactivation_deliveries_agent_idx on public.reactivation_deliveries (agent_id, created_at desc);
create index if not exists reactivation_deliveries_due_idx on public.reactivation_deliveries (bill_after) where status = 'pending';
alter table public.reactivation_deliveries enable row level security;
revoke all on public.reactivation_deliveries from public, anon, authenticated;
grant select on public.reactivation_deliveries to authenticated;
drop policy if exists reactivation_deliveries_read on public.reactivation_deliveries;
create policy reactivation_deliveries_read on public.reactivation_deliveries for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());

alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly', 'plan_upgrade', 'signup', 'plan_month', 'live_check', 'reactivation',
                  'product_add', 'reactivation_delivery'));

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, v.roles, v.label, false, null, true, true, v.money, true, coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values ('reactivation_delivered', array['agent'], 'A reactivated lead was delivered (booked or live call)', true, 1),
               ('reactivation_card_paused', array['agent'], 'Reactivation calls paused: the card was declined', true, 2),
               ('reactivation_watch', array['admin'], 'A reactivation account to look at (shared card, calls with nothing paid)', false, 3)) as v(type, roles, label, money, n)
 where not exists (select 1 from public.notification_types t where t.type = v.type);

-- ── 5. Limits ───────────────────────────────────────────────────────────────────────────────────────────────────
-- An agent's reactivation limits: new until new_until_paid deliveries are paid.
create or replace function public.reactivation_limits(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s reactivation_settings; paid int; active int; calls int; is_new boolean;
begin
  select * into s from reactivation_settings where id;
  select count(*) into paid from reactivation_deliveries where agent_id = p_agent and status = 'paid';
  select coalesce(sum(callable), 0) into active from reactivation_lists
   where agent_id = p_agent and status in ('waiting_scrub', 'working', 'paused');
  select count(*) into calls from ai_calls where agent_id = p_agent and reactivation_contact_id is not null
     and created_at >= ((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago';
  is_new := paid < s.new_until_paid;
  return jsonb_build_object('is_new', is_new, 'paid', paid, 'until_paid', s.new_until_paid, 'active', active,
    'max_callable', case when is_new then s.new_max_callable else s.max_callable end,
    'room', greatest(0, case when is_new then s.new_max_callable - active else s.max_callable end),
    'daily_calls', case when is_new then s.new_daily_calls else s.daily_calls end, 'calls_today', calls);
end;
$$;
revoke execute on function public.reactivation_limits(uuid) from public, anon, authenticated;

-- ── 6. The agent's side ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reactivation_terms()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s reactivation_settings; me uuid := auth.uid(); c reactivation_cards;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from reactivation_settings where id;
  select * into c from reactivation_cards where agent_id = me order by checked_at desc limit 1;
  return jsonb_build_object('model', 'per_delivered', 'delivered_cents', s.delivered_cents, 'transfer_min_secs', s.transfer_min_secs,
    'max_attempts', s.max_attempts, 'cadence_days', to_jsonb(s.cadence_days),
    'live', coalesce((select reactivation_live from recovery_config limit 1), false),
    'scrub_connected', s.scrub_provider <> 'none', 'limits', reactivation_limits(me),
    'card', case when c.id is null then null else jsonb_build_object('status', c.status, 'brand', c.brand, 'last4', c.last4, 'checked_at', c.checked_at) end,
    'owed', (select count(*) from reactivation_deliveries where agent_id = me and status = 'failed'),
    'licensed', to_jsonb(coalesce((select coalesce(licensed_states, states) from agent_lead_settings where agent_id = me), '{}'::text[])));
end;
$$;
revoke execute on function public.reactivation_terms() from public, anon;
grant execute on function public.reactivation_terms() to authenticated;

-- Make a list (free). Same cleaning as 267, no minimum, and the new-account room: people past it are left off
-- (removed.over_limit). A number another account already uploaded is kept but flagged (dupe, admin sees it).
drop function if exists public.reactivation_create(text, jsonb, boolean, text);
create or replace function public.reactivation_create(p_name text, p_rows jsonb, p_attest boolean, p_attest_version text default 'p957-v1')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid(); s reactivation_settings; lic text[]; lid uuid; x jsonb; ph text; st text; lim jsonb; room int;
  seen text[] := '{}'; rm jsonb := jsonb_build_object('bad_number', 0, 'duplicate', 0, 'existing', 0, 'unlicensed', 0, 'dnc', 0, 'over_limit', 0);
  kept int := 0; why text; d dnc_numbers; dup boolean; ndup int := 0;
begin
  if me is null or (select role::text from profiles where id = me) is distinct from 'agent' then
    raise exception 'Agents only' using errcode = '42501';
  end if;
  if not coalesce(p_attest, false) then raise exception 'Tick the line about the list first' using hint = 'attest'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The list is empty' using hint = 'empty'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Up to 5,000 people per list' using hint = 'too_many'; end if;
  if exists (select 1 from reactivation_deliveries where agent_id = me and status = 'failed') then
    raise exception 'Update your card first: a $% charge didn''t go through.', (select delivered_cents / 100 from reactivation_settings where id)
      using hint = 'card_owed';
  end if;
  select * into s from reactivation_settings where id;
  lim := reactivation_limits(me);
  room := (lim ->> 'room')::int;
  if room <= 0 then
    raise exception 'You can have up to % people being called until % appointments are paid.', lim ->> 'max_callable', s.new_until_paid
      using hint = 'over_limit';
  end if;
  lic := coalesce((select coalesce(licensed_states, states) from agent_lead_settings where agent_id = me), '{}');
  insert into reactivation_lists (agent_id, name, status, uploaded, price_cents_each, attest_text, attest_version, attested_at, model)
  values (me, left(coalesce(nullif(trim(p_name), ''), 'Old leads'), 120), 'draft', jsonb_array_length(p_rows), s.delivered_cents,
          'These people asked to be contacted about life insurance, and I have the right to have them contacted by phone. I’m responsible for this list.',
          left(coalesce(p_attest_version, 'p957-v1'), 40), now(), 'per_delivered')
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
    if why is null and kept >= room then why := 'over_limit'; end if;
    if ph is not null then seen := seen || ph; end if;
    if why is not null then rm := jsonb_set(rm, array[why], to_jsonb((rm ->> why)::int + 1)); continue; end if;
    dup := exists (select 1 from reactivation_contacts c where c.phone = ph and c.agent_id <> me);
    if dup then ndup := ndup + 1; end if;
    insert into reactivation_contacts (list_id, agent_id, first_name, last_name, phone, state, age, mortgage_cents, lead_date, source, dupe)
    values (lid, me, left(nullif(trim(x ->> 'first'), ''), 60), left(nullif(trim(x ->> 'last'), ''), 60), ph, st,
            case when (x ->> 'age') ~ '^\d{1,3}$' and (x ->> 'age')::int between 18 and 110 then (x ->> 'age')::int end,
            case when (x ->> 'mortgage_cents') ~ '^\d{1,12}$' and (x ->> 'mortgage_cents')::bigint > 0 then (x ->> 'mortgage_cents')::bigint end,
            left(nullif(trim(x ->> 'lead_date'), ''), 40), left(nullif(trim(x ->> 'source'), ''), 80), dup);
    kept := kept + 1;
  end loop;
  if kept = 0 then raise exception 'After cleaning, nobody is left to call.' using hint = 'empty'; end if;
  update reactivation_lists set removed = rm, callable = kept, amount_cents = 0, over_limit = (rm ->> 'over_limit')::int, dupes = ndup,
         updated_at = now() where id = lid;
  return jsonb_build_object('list_id', lid, 'uploaded', jsonb_array_length(p_rows), 'callable', kept, 'removed', rm, 'dupes', ndup,
                            'delivered_cents', s.delivered_cents, 'amount_cents', 0, 'limits', lim);
end;
$$;
revoke execute on function public.reactivation_create(text, jsonb, boolean, text) from public, anon;
grant execute on function public.reactivation_create(text, jsonb, boolean, text) to authenticated;

-- lead-spend starts a draft list once the card check passed (no charge). The room is checked again here.
create or replace function public.reactivation_start_list(p_list uuid, p_agent uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare rl reactivation_lists; lim jsonb;
begin
  select * into rl from reactivation_lists where id = p_list for update;
  if rl.id is null or rl.agent_id is distinct from p_agent then raise exception 'No such list' using errcode = '42501'; end if;
  if rl.status <> 'draft' or rl.model <> 'per_delivered' then raise exception 'This list has already started' using hint = 'already_paid'; end if;
  if not reactivation_card_ok(p_agent) then raise exception 'Check your card first' using hint = 'no_card'; end if;
  if exists (select 1 from reactivation_deliveries where agent_id = p_agent and status = 'failed') then
    raise exception 'Update your card first' using hint = 'card_owed';
  end if;
  lim := reactivation_limits(p_agent);
  if rl.callable > (lim ->> 'room')::int then
    raise exception 'You can have up to % people being called until % appointments are paid.', lim ->> 'max_callable', lim ->> 'until_paid'
      using hint = 'over_limit';
  end if;
  update reactivation_lists set status = 'waiting_scrub', paid_at = now(), updated_at = now() where id = p_list;
  update reactivation_contacts set status = 'waiting_scrub', updated_at = now() where list_id = p_list and status <> 'removed';
  perform billing_log(p_agent, 'reactivation_started', null, jsonb_build_object('list', p_list, 'callable', rl.callable), null);
  if rl.dupes > 0 then
    perform route_notify_admins('reactivation_watch', 'Same people on two reactivation accounts',
      coalesce((select full_name from profiles where id = p_agent), 'An agent') || '''s list "' || rl.name || '" has ' || rl.dupes
        || ' people another account already uploaded.', '/admin/inbounds?view=reactivation', 'reactivation_dupes:' || p_list);
  end if;
  return jsonb_build_object('status', 'waiting_scrub', 'list_id', p_list, 'callable', rl.callable);
end;
$$;
revoke execute on function public.reactivation_start_list(uuid, uuid) from public, anon, authenticated;

-- The P952 pay-per-list charge is retired: lists are free to start.
create or replace function public.reactivation_charge_start(p_list uuid, p_agent uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  raise exception 'Lists are free to start now. You pay for each appointment or live call we deliver.' using hint = 'retired';
end;
$$;
revoke execute on function public.reactivation_charge_start(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_reactivation_lists()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'status', l.status, 'created_at', l.created_at, 'model', l.model,
           'uploaded', l.uploaded, 'removed', l.removed, 'callable', l.callable, 'amount_cents', l.amount_cents,
           'price_cents_each', l.price_cents_each, 'refunded_cents', l.refunded_cents, 'paid_at', l.paid_at, 'started_at', l.started_at,
           'pause_kind', l.pause_kind, 'pause_reason', l.pause_reason, 'progress', reactivation_progress(l.id),
           'delivered', (select count(*) from reactivation_deliveries d where d.list_id = l.id and d.status = 'paid'),
           'charged_cents', (select coalesce(sum(d.amount_cents - d.refunded_cents), 0) from reactivation_deliveries d where d.list_id = l.id and d.status in ('paid', 'refunded')),
           'owed', (select count(*) from reactivation_deliveries d where d.list_id = l.id and d.status in ('failed', 'charging', 'pending')))
           order by l.created_at desc), '[]'::jsonb)
    from reactivation_lists l where l.agent_id = auth.uid() and l.status <> 'cancelled'
$$;
revoke execute on function public.my_reactivation_lists() from public, anon;
grant execute on function public.my_reactivation_lists() to authenticated;

-- A free list's scrub takes people off with nothing to pay back (267 refunded $2 each on per-lead lists).
create or replace function public.reactivation_scrub_done(p_list uuid, p_flagged jsonb, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rl reactivation_lists; f jsonb; n_nat int := 0; n_lit int := 0; n int := 0; back int;
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
  back := case when rl.model = 'per_lead' then n * rl.price_cents_each else 0 end;
  update reactivation_lists set status = 'working', scrubbed_at = now(), scrub_provider = left(p_provider, 40), started_at = now(),
         callable = callable - n, refund_due_cents = refund_due_cents + back,
         removed = removed || jsonb_build_object('national_dnc', n_nat, 'litigator', n_lit), updated_at = now()
   where id = p_list;
  update reactivation_contacts set status = 'queued', next_at = now(), updated_at = now() where list_id = p_list and status = 'waiting_scrub';
  return jsonb_build_object('ok', true, 'removed', n, 'national_dnc', n_nat, 'litigator', n_lit, 'refund_cents', back);
end;
$$;
revoke execute on function public.reactivation_scrub_done(uuid, jsonb, text) from public, anon, authenticated;

-- ── 7. Who may be called (267's rules + a free rebook on a finished list; a card pause stops everything) ────────
create or replace function public.reactivation_callable(rc reactivation_contacts, rl reactivation_lists)
returns boolean language sql stable security definer set search_path = public as $$
  select rl.status = 'working' or (rc.rebook and rl.status = 'done')
$$;
revoke execute on function public.reactivation_callable(reactivation_contacts, reactivation_lists) from public, anon, authenticated;

create or replace function public.ai_caller_takes(p_lead uuid)
returns table(by text, reason text) language plpgsql stable security definer set search_path = public as $$
declare l public.leads; s public.ai_caller_settings; chk record; rc public.reactivation_contacts; rl public.reactivation_lists; d public.dnc_numbers;
begin
  select * into l from public.leads where id = p_lead;
  if l.reactivation_id is not null then
    select * into rc from public.reactivation_contacts where id = l.reactivation_id;
    select * into rl from public.reactivation_lists where id = rc.list_id;
    if public.profile_is_test(l.assigned_rep_id) then return query select 'va', 'test_account'; return; end if;
    if not coalesce((select reactivation_live from public.recovery_config limit 1), false) then
      return query select 'va', 'switch_off'; return;
    end if;
    if not public.reactivation_callable(rc, rl) then return query select 'va', 'list_' || coalesce(rl.status, 'missing'); return; end if;
    if exists (select 1 from public.reactivation_deliveries where agent_id = rc.agent_id and status = 'failed') then
      return query select 'va', 'card_owed'; return;                           -- P957: a declined $20 stops every call
    end if;
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
    return query select 'va', 'not_form'; return;
  end if;
  if public.profile_is_test(l.assigned_rep_id) then
    return query select 'va', 'test_account'; return;
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

-- ── 8. After a reactivation call: a booking or a transfer is a DELIVERY, charged before the lead shows ───────────
create or replace function public.reactivation_after_call(p_call uuid, p_outcome text, p_callback_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c   ai_calls; rc reactivation_contacts; rl reactivation_lists; s reactivation_settings;
  max_ int; nxt timestamptz; st text; vm boolean; dl jsonb;
begin
  select * into c from ai_calls where id = p_call;
  select * into rc from reactivation_contacts where id = c.reactivation_contact_id for update;
  if rc.id is null then return jsonb_build_object('ok', false, 'code', 'no_contact'); end if;
  select * into rl from reactivation_lists where id = rc.list_id;
  select * into s from reactivation_settings where id;
  max_ := least(s.max_attempts, cardinality(s.cadence_days));
  vm := p_outcome = 'no_answer' and coalesce(c.summary, '') ilike '%voicemail%';

  if rc.rebook and p_outcome not in ('booked', 'transferred', 'hard_no', 'opt_out', 'wrong_number') then
    -- A no-show rebook: one more try the next day, then it's over (the person stays on the board as they are).
    st := case when rc.rebook_tries < 2 and p_outcome = 'no_answer' then 'queued' else p_outcome end;
    st := case st when 'queued' then 'queued' when 'not_now' then 'not_now' else 'no_answer' end;
    if st = 'queued' then nxt := coalesce(reactivation_window_next(rc.state, now() + interval '20 hours'), now() + interval '1 day'); end if;
  else
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
  end if;

  update reactivation_contacts set status = st, attempts = greatest(attempts, c.attempt), last_called_at = now(), last_outcome = p_outcome,
         reached = reached or p_outcome in ('booked', 'transferred', 'not_now', 'hard_no', 'opt_out'),
         voicemail_left = voicemail_left or vm, next_at = case when st = 'queued' then nxt end,
         rebook = case when st = 'queued' then rebook else false end,
         rebook_tries = case when rebook then rebook_tries + 1 else rebook_tries end, updated_at = now()
   where id = rc.id;

  if p_outcome in ('booked', 'transferred') then
    -- The board's stage and first call move now, but the lead stays HIDDEN until its $20 is paid (reactivation_deliver).
    update leads set first_call_outcome = coalesce(first_call_outcome, p_outcome), first_call_at = coalesce(first_call_at, now()),
           first_call_by = coalesce(first_call_by, 'ai'),
           inbound_stage = case when p_outcome = 'booked' then 'booked' else inbound_stage end
     where id = c.lead_id;
    dl := reactivation_deliver(c.id, p_outcome);
  elsif p_outcome in ('hard_no', 'opt_out') then
    insert into dnc_numbers (phone, internal, source, note) values (rc.phone, true, 'reactivation',
           case when p_outcome = 'opt_out' then 'Asked not to be called (reactivation)' else 'Not interested (reactivation)' end)
    on conflict (phone) do update set internal = true, source = coalesce(dnc_numbers.source, 'reactivation');
    update leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_at = now(),
           outcome_reason = case when p_outcome = 'opt_out' then 'Asked not to be called' else 'Not interested' end
     where id = c.lead_id;
    update reactivation_texts set status = 'cancelled' where contact_id = rc.id and status = 'queued';
  end if;

  perform reactivation_list_check(rl.id);
  return jsonb_build_object('ok', true, 'status', st, 'next_at', nxt, 'delivery', dl);
end;
$$;
revoke execute on function public.reactivation_after_call(uuid, text, timestamptz) from public, anon, authenticated;

-- One delivery per person: the first booking/transfer owes delivered_cents; a later one (a no-show rebook, a second
-- booking) after it's paid is free; while it's still owed nothing new is added. A booking is charged at once, a live
-- transfer once it has been connected for transfer_min_secs.
create or replace function public.reactivation_deliver(p_call uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c ai_calls; rc reactivation_contacts; s reactivation_settings; did uuid; free_ boolean;
begin
  select * into c from ai_calls where id = p_call;
  select * into rc from reactivation_contacts where id = c.reactivation_contact_id;
  if rc.id is null then return null; end if;
  select * into s from reactivation_settings where id;
  if exists (select 1 from reactivation_deliveries where contact_id = rc.id and status in ('pending', 'charging', 'failed')) then
    return jsonb_build_object('status', 'already_owed');
  end if;
  free_ := exists (select 1 from reactivation_deliveries where contact_id = rc.id and status = 'paid');
  insert into reactivation_deliveries (contact_id, list_id, agent_id, lead_id, call_id, kind, status, amount_cents, bill_after)
  values (rc.id, rc.list_id, rc.agent_id, c.lead_id, c.id, p_kind, case when free_ then 'free_rebook' else 'pending' end,
          case when free_ then 0 else s.delivered_cents end,
          case when p_kind = 'transferred' then now() + make_interval(secs => s.transfer_min_secs) else now() end)
  returning id into did;
  if free_ then
    insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
    values (c.lead_id, rc.agent_id, 'note', 'Rebooked by our team. No charge (already delivered).', jsonb_build_object('reactivation', true, 'free_rebook', true), 'Our team', 'team');
    return jsonb_build_object('status', 'free_rebook', 'delivery_id', did);
  end if;
  if p_kind = 'booked' then perform reactivation_bill(did); end if;
  return jsonb_build_object('status', 'pending', 'delivery_id', did);
end;
$$;
revoke execute on function public.reactivation_deliver(uuid, text) from public, anon, authenticated;

-- Make the $20 charge for one due delivery and ask lead-spend to run it now (pg_net; no-op where pg_net is missing).
create or replace function public.reactivation_bill(p_delivery uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d reactivation_deliveries; ch uuid; n int;
begin
  select * into d from reactivation_deliveries where id = p_delivery for update;
  if d.id is null or d.status <> 'pending' or d.bill_after > now() then return null; end if;
  select count(*) into n from lead_spend_charges where key like 'reactivation_delivery:' || d.id || ':%';
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
  values (d.agent_id, billing_week_of(billing_today()), 'reactivation_delivery', d.amount_cents, 'reactivation_delivery:' || d.id || ':' || (n + 1),
          left('Reactivation · ' || case when d.kind = 'booked' then 'appointment booked' else 'live call' end
               || ' · $' || to_char(d.amount_cents / 100.0, 'FM999,990.00'), 300))
  returning id into ch;
  update reactivation_deliveries set status = 'charging', charge_id = ch, updated_at = now() where id = d.id;
  begin
    perform fulfillment_cron_post('lead-spend', jsonb_build_object('action', 'reactivation_charge', 'agent_id', d.agent_id));
  exception when others then raise warning 'reactivation_bill post: %', sqlerrm;   -- lead-spend's 15-minute run picks it up
  end;
  return ch;
end;
$$;
revoke execute on function public.reactivation_bill(uuid) from public, anon, authenticated;

-- A transfer's connected time, when the voice provider reports it. Under transfer_min_secs: free (refunded if paid).
create or replace function public.reactivation_transfer_secs(p_call uuid, p_secs int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d reactivation_deliveries; s reactivation_settings;
begin
  select * into s from reactivation_settings where id;
  select * into d from reactivation_deliveries where call_id = p_call and kind = 'transferred' order by created_at desc limit 1 for update;
  if d.id is null then return jsonb_build_object('ok', false, 'code', 'no_delivery'); end if;
  update reactivation_deliveries set transfer_secs = greatest(0, p_secs), updated_at = now() where id = d.id;
  if p_secs >= s.transfer_min_secs then return jsonb_build_object('ok', true, 'status', d.status); end if;
  if d.status = 'pending' then
    update reactivation_deliveries set status = 'short', amount_cents = 0, updated_at = now() where id = d.id;
    return jsonb_build_object('ok', true, 'status', 'short');
  elsif d.status in ('charging', 'paid') then
    update reactivation_deliveries set refund_due_cents = amount_cents, updated_at = now() where id = d.id;
    return jsonb_build_object('ok', true, 'status', 'refund_due');
  elsif d.status = 'failed' then
    update reactivation_deliveries set status = 'short', amount_cents = 0, updated_at = now() where id = d.id;
    update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · under ' || s.transfer_min_secs || ' s, no charge', 300), updated_at = now()
     where id = d.charge_id and status in ('failed', 'due');
    perform reactivation_card_resume(d.agent_id);
    return jsonb_build_object('ok', true, 'status', 'short');
  end if;
  return jsonb_build_object('ok', true, 'status', d.status);
end;
$$;
revoke execute on function public.reactivation_transfer_secs(uuid, int) from public, anon, authenticated;

-- Lists paused for the card start calling again once nothing is owed.
create or replace function public.reactivation_card_resume(p_agent uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if exists (select 1 from reactivation_deliveries where agent_id = p_agent and status = 'failed') then return 0; end if;
  update reactivation_lists set status = 'working', paused_at = null, pause_reason = null, pause_kind = null, updated_at = now()
   where agent_id = p_agent and status = 'paused' and pause_kind = 'card';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.reactivation_card_resume(uuid) from public, anon, authenticated;

-- The charge's result (lead_spend_charge_result's 'reactivation_delivery' branch).
create or replace function public.reactivation_delivery_result(c lead_spend_charges, p_status text, p_pi text, p_failure text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d reactivation_deliveries; l leads; s reactivation_settings; n int;
begin
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = c.id;
  select * into d from reactivation_deliveries where charge_id = c.id for update;
  if d.id is null then return jsonb_build_object('status', p_status, 'code', 'no_delivery'); end if;
  select * into s from reactivation_settings where id;
  if p_status = 'paid' then
    update reactivation_deliveries set status = case when status = 'short' then 'short' else 'paid' end, paid_at = now(), failure = null,
           refund_due_cents = case when status = 'short' then amount_cents else refund_due_cents end, updated_at = now()
     where id = d.id;
    -- Paid: now the agent sees the person (name, number, the booking) on their board, Delivered.
    update leads set reactivated_at = coalesce(reactivated_at, now()), delivered_at = coalesce(delivered_at, now())
     where id = d.lead_id returning * into l;
    insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
    values (d.lead_id, d.agent_id, 'note', 'Reactivated: ' || case when d.kind = 'booked' then 'appointment booked' else 'live call' end
              || '. $' || to_char(d.amount_cents / 100.0, 'FM999,990.00') || ' charged.', jsonb_build_object('reactivation', true, 'delivery', d.id), 'Our team', 'team');
    perform notify(d.agent_id, 'reactivation_delivered',
      case when d.kind = 'booked' then 'New appointment from your old leads' else 'Live call from your old leads' end,
      coalesce(nullif(l.contact_name, ''), 'Someone on your list') || case when d.kind = 'booked' then ' booked a call with you.' else ' was connected to you.' end
        || ' $' || to_char(d.amount_cents / 100.0, 'FM999,990.00') || ' charged.',
      '/leads?lead=' || d.lead_id, false, 'reactivation_delivered:' || d.id, jsonb_build_object('lead_id', d.lead_id));
    perform billing_log(d.agent_id, 'reactivation_delivered', null, jsonb_build_object('charge', c.id, 'delivery', d.id, 'cents', c.amount_cents), null);
    perform reactivation_card_resume(d.agent_id);
  elsif p_status = 'failed' then
    update reactivation_deliveries set status = 'failed', failed_at = now(), failure = left(coalesce(p_failure, 'Declined'), 300), updated_at = now()
     where id = d.id and status in ('charging', 'pending');
    -- Declined: every list stops calling at once, until the card is fixed and this charge goes through.
    update reactivation_lists set status = 'paused', paused_at = now(), pause_kind = 'card', updated_at = now(),
           pause_reason = 'Your card was declined for a $' || to_char(d.amount_cents / 100.0, 'FM999,990.00') || ' ' ||
                          case when d.kind = 'booked' then 'appointment' else 'live call' end || '. Update your card to keep calling.'
     where agent_id = d.agent_id and status in ('working', 'waiting_scrub');
    get diagnostics n = row_count;
    perform notify(d.agent_id, 'reactivation_card_paused', 'Update your card to keep calling',
      'We delivered ' || case when d.kind = 'booked' then 'an appointment' else 'a live call' end || ' from your old leads, but the $'
        || to_char(d.amount_cents / 100.0, 'FM999,990.00') || ' charge was declined. Calls are paused until your card is updated.',
      '/billing', true, 'reactivation_card_paused:' || d.id, '{}'::jsonb);
  elsif p_status = 'processing' then
    update reactivation_deliveries set status = 'charging', updated_at = now() where id = d.id and status = 'pending';
  end if;
  return jsonb_build_object('status', p_status, 'delivery_id', d.id);
end;
$$;
revoke execute on function public.reactivation_delivery_result(lead_spend_charges, text, text, text) from public, anon, authenticated;

-- One door for every result (268's, wrapped): a 'reactivation_delivery' charge goes to reactivation_delivery_result.
alter function public.lead_spend_charge_result(uuid, text, text, text) rename to lead_spend_charge_result_p955;
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  select * into c from lead_spend_charges where id = p_id;
  if not found then raise exception 'no such charge'; end if;
  if c.kind <> 'reactivation_delivery' then return lead_spend_charge_result_p955(p_id, p_status, p_pi, p_failure); end if;
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  return reactivation_delivery_result(c, p_status, p_pi, p_failure);
end; $$;

-- Refunds: the P952 per-lead scrub refunds, plus a delivered transfer that turned out shorter than the minimum.
create or replace function public.reactivation_refunds_due()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('list_id', l.id, 'charge_id', l.charge_id, 'pi', c.stripe_pi, 'cents', l.refund_due_cents - l.refunded_cents,
                            'key', 'reactivation_refund:' || l.id || ':' || l.refund_due_cents)
    from reactivation_lists l join lead_spend_charges c on c.id = l.charge_id
   where l.refund_due_cents > l.refunded_cents and c.status = 'paid' and c.stripe_pi is not null
  union all
  select jsonb_build_object('delivery_id', d.id, 'charge_id', d.charge_id, 'pi', c.stripe_pi, 'cents', d.refund_due_cents - d.refunded_cents,
                            'key', 'reactivation_delivery_refund:' || d.id || ':' || d.refund_due_cents)
    from reactivation_deliveries d join lead_spend_charges c on c.id = d.charge_id
   where d.refund_due_cents > d.refunded_cents and c.status = 'paid' and c.stripe_pi is not null
$$;
create or replace function public.reactivation_delivery_refunded(p_delivery uuid, p_cents int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d reactivation_deliveries;
begin
  update reactivation_deliveries set refunded_cents = least(refund_due_cents, refunded_cents + greatest(0, p_cents)),
         status = case when least(refund_due_cents, refunded_cents + greatest(0, p_cents)) >= amount_cents then 'refunded' else status end,
         updated_at = now()
   where id = p_delivery returning * into d;
  if d.id is null then raise exception 'no such delivery'; end if;
  perform billing_charge_refunded(d.charge_id, p_cents);
  update lead_spend_charges set note = left(coalesce(note, '') || ' · refunded (live call under '
                                            || (select transfer_min_secs from reactivation_settings where id) || ' s)', 300)
   where id = d.charge_id and coalesce(note, '') not like '%refunded%';
  return jsonb_build_object('refunded_cents', d.refunded_cents);
end;
$$;
revoke execute on function public.reactivation_refunds_due(), public.reactivation_delivery_refunded(uuid, int) from public, anon, authenticated;

-- ── 9. Texts only after they book and say yes ───────────────────────────────────────────────────────────────────
create table if not exists public.reactivation_texts (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.reactivation_contacts(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete cascade,
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  call_id     uuid references public.ai_calls(id) on delete set null,
  step_key    text not null check (step_key in ('bk_confirm', 'bk_day_before', 'bk_morning', 'bk_1h')),
  appt_at     timestamptz not null,
  send_at     timestamptz not null,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  from_number text,
  sent_at     timestamptz,
  provider_id text,
  failure     text check (char_length(failure) <= 300),
  created_at  timestamptz not null default now(),
  unique (contact_id, step_key, appt_at)
);
create index if not exists reactivation_texts_due_idx on public.reactivation_texts (send_at) where status = 'queued';
alter table public.reactivation_texts enable row level security;
revoke all on public.reactivation_texts from public, anon, authenticated;
grant select on public.reactivation_texts to authenticated;
drop policy if exists reactivation_texts_admin on public.reactivation_texts;
create policy reactivation_texts_admin on public.reactivation_texts for select to authenticated using (public.is_admin());

-- The AI asked "Can I text you the confirmation?" after booking. Yes → kept with the call as the person's consent, and
-- the booking texts are queued for this one person (only those still in the future). No → nothing, calls only.
create or replace function public.reactivation_text_consent(p_call uuid, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c ai_calls; rc reactivation_contacts; tz text; appt timestamptz; n int := 0; local_day date;
begin
  select * into c from ai_calls where id = p_call;
  select * into rc from reactivation_contacts where id = c.reactivation_contact_id for update;
  if rc.id is null then return jsonb_build_object('ok', false, 'code', 'not_reactivation'); end if;
  update reactivation_contacts set text_ok = coalesce(p_yes, false), text_ok_at = now(), text_ok_call = c.id, updated_at = now() where id = rc.id;
  update leads set qualifier_answers = coalesce(qualifier_answers, '{}'::jsonb) || jsonb_build_object(
           'sms_consent', coalesce(p_yes, false), 'sms_consent_at', now(), 'sms_consent_source', 'reactivation_call', 'sms_consent_call', c.id,
           'sms_consent_words', 'Can I text you the confirmation?')
   where id = c.lead_id;
  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, rc.agent_id, 'note', case when p_yes then 'Said yes to booking texts on the call' else 'Said no to texts on the call (calls only)' end,
          jsonb_build_object('reactivation', true, 'sms_consent', coalesce(p_yes, false), 'call', c.id), 'Our team', 'team');
  appt := c.booked_for;
  if not coalesce(p_yes, false) or appt is null then
    update reactivation_texts set status = 'cancelled' where contact_id = rc.id and status = 'queued';
    return jsonb_build_object('ok', true, 'queued', 0);
  end if;
  tz := coalesce((select r.tz[1] from state_call_rules r where r.state = rc.state), 'America/Chicago');
  local_day := (appt at time zone tz)::date;
  insert into reactivation_texts (contact_id, lead_id, agent_id, call_id, step_key, appt_at, send_at)
  select rc.id, c.lead_id, rc.agent_id, c.id, k, appt, at
    from (values ('bk_confirm', now()),
                 ('bk_day_before', ((local_day - 1) + time '18:30') at time zone tz),
                 ('bk_morning', (local_day + time '08:30') at time zone tz),
                 ('bk_1h', appt - interval '1 hour')) v(k, at)
   where v.k = 'bk_confirm' or (v.at > now() and v.at < appt)
  on conflict (contact_id, step_key, appt_at) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'queued', n);
end;
$$;
revoke execute on function public.reactivation_text_consent(uuid, boolean) from public, anon, authenticated;

-- The reactivation function (service role) takes texts that are due, only while texts AND reactivation are on, only
-- to someone who said yes and hasn't opted out, only for the booking they said yes to, from a reactivation number.
create or replace function public.reactivation_texts_claim(p_limit int default 20)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare t record; n reactivation_contacts; num record;
begin
  if not coalesce((select sms_live and reactivation_live from recovery_config limit 1), false) then return; end if;
  for t in select x.* from reactivation_texts x where x.status = 'queued' and x.send_at <= now()
            order by x.send_at limit greatest(1, least(p_limit, 50)) for update skip locked loop
    select * into n from reactivation_contacts where id = t.contact_id;
    if not coalesce(n.text_ok, false) or sms_is_opted_out(n.phone) or n.status in ('stop', 'not_interested', 'wrong_number')
       or t.appt_at <> coalesce((select booked_for from ai_calls where id = n.text_ok_call), t.appt_at)
       or (t.step_key <> 'bk_confirm' and t.appt_at <= now()) then
      update reactivation_texts set status = 'cancelled' where id = t.id; continue;
    end if;
    select * into num from reactivation_number();
    if num.id is null then continue; end if;                     -- no reactivation number: wait (never a main number)
    update reactivation_texts set status = 'sending', from_number = num.phone where id = t.id;
    return next jsonb_build_object('id', t.id, 'step', t.step_key, 'to', n.phone, 'from', num.phone, 'first', coalesce(n.first_name, ''),
      'agent', coalesce(split_part((select full_name from profiles where id = t.agent_id), ' ', 1), 'Your specialist'),
      'appt_at', t.appt_at, 'tz', coalesce((select r.tz[1] from state_call_rules r where r.state = n.state), 'America/Chicago'));
  end loop;
end;
$$;
create or replace function public.reactivation_text_sent(p_id uuid, p_ok boolean, p_provider_id text default null, p_failure text default null)
returns void language sql security definer set search_path = public as $$
  update reactivation_texts set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() end,
         provider_id = left(p_provider_id, 80), failure = left(p_failure, 300)
   where id = p_id and status = 'sending'
$$;
revoke execute on function public.reactivation_texts_claim(int), public.reactivation_text_sent(uuid, boolean, text, text) from public, anon, authenticated;

-- ── 10. A no-show is rebooked by the AI, free ───────────────────────────────────────────────────────────────────
create or replace function public.reactivation_no_show()
returns trigger language plpgsql security definer set search_path = public as $$
declare rc reactivation_contacts;
begin
  if new.kind = 'no_show' and new.state = 'done' and not coalesce(new.is_sample, false) then
    select c.* into rc from reactivation_contacts c join leads l on l.reactivation_id = c.id where l.id = new.lead_id;
    if rc.id is not null and rc.status in ('booked', 'transferred') and not exists (select 1 from dnc_numbers where phone = rc.phone and internal) then
      update reactivation_contacts set status = 'queued', rebook = true, rebook_tries = 0, updated_at = now(),
             next_at = coalesce(reactivation_window_next(rc.state, now() + interval '2 hours'), now() + interval '1 day')
       where id = rc.id and attempts < 10;
      update reactivation_texts set status = 'cancelled' where contact_id = rc.id and status = 'queued';
    end if;
  end if;
  return new;
exception when others then raise warning 'reactivation_no_show: %', sqlerrm; return new;
end;
$$;
revoke execute on function public.reactivation_no_show() from public, anon, authenticated;
drop trigger if exists inbound_events_reactivation_no_show on public.inbound_events;
create trigger inbound_events_reactivation_no_show after insert on public.inbound_events
  for each row execute function public.reactivation_no_show();

-- ── 11. The dialer: 267's tick + the daily cap, rebooks, the transfers to charge and the texts to send ─────────────
create or replace function public.reactivation_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; lid uuid; cid uuid; started int := 0; later int := 0; stale int := 0; capped int := 0; billed int := 0;
        rl reactivation_lists; lim jsonb;
begin
  if not coalesce((select reactivation_live from recovery_config limit 1), false) then return jsonb_build_object('off', true); end if;
  if not pg_try_advisory_xact_lock(hashtext('reactivation_tick')) then return jsonb_build_object('skipped', true); end if;
  -- Live transfers connected long enough: charge them now.
  for r in select d.id from reactivation_deliveries d where d.status = 'pending' and d.bill_after <= now() order by d.bill_after limit 50 loop
    if reactivation_bill(r.id) is not null then billed := billed + 1; end if;
  end loop;
  for r in select c.id from ai_calls c where c.reactivation_contact_id is not null and c.status = 'queued' and c.created_at < now() - interval '2 minutes' loop
    perform ai_caller_to_va(r.id, 'not_started'); stale := stale + 1;
  end loop;
  update reactivation_contacts rc set status = 'queued', next_at = now(), updated_at = now()
   where rc.status = 'calling' and rc.updated_at < now() - interval '30 minutes'
     and not exists (select 1 from ai_calls c where c.reactivation_contact_id = rc.id and c.status not in ('done', 'to_va'));

  for r in select rc.* from reactivation_contacts rc join reactivation_lists l on l.id = rc.list_id
            where rc.status = 'queued' and rc.next_at <= now() and (l.status = 'working' or (rc.rebook and l.status = 'done'))
              and not public.profile_is_test(rc.agent_id)
              and not exists (select 1 from reactivation_deliveries d where d.agent_id = rc.agent_id and d.status = 'failed')
            order by rc.next_at limit 30 for update of rc skip locked loop
    if not reactivation_window_ok(r.state, now()) then
      update reactivation_contacts set next_at = coalesce(reactivation_window_next(r.state, now()), now() + interval '1 day'), updated_at = now() where id = r.id;
      later := later + 1; continue;
    end if;
    lim := reactivation_limits(r.agent_id);
    if (lim ->> 'calls_today')::int >= (lim ->> 'daily_calls')::int then
      -- The account's calls for today are used up: tomorrow, in this person's hours.
      update reactivation_contacts set next_at = coalesce(reactivation_window_next(r.state,
               (((now() at time zone 'America/Chicago')::date + 1)::timestamp at time zone 'America/Chicago')), now() + interval '1 day'), updated_at = now()
       where id = r.id;
      capped := capped + 1; continue;
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
  -- Booking texts waiting to go (only while texts are on, and only for people who said yes).
  if coalesce((select sms_live from recovery_config limit 1), false)
     and exists (select 1 from reactivation_texts where status = 'queued' and send_at <= now()) then
    begin perform fulfillment_cron_post('reactivation', jsonb_build_object('action', 'texts'));
    exception when others then raise warning 'reactivation texts post: %', sqlerrm; end;
  end if;
  return jsonb_build_object('started', started, 'later', later, 'stale', stale, 'capped', capped, 'billed', billed);
end;
$$;
revoke execute on function public.reactivation_tick() from public, anon, authenticated;

-- ── 12. Admin ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reactivation_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s reactivation_settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into s from reactivation_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('delivered_cents', s.delivered_cents, 'transfer_min_secs', s.transfer_min_secs,
                  'new_until_paid', s.new_until_paid, 'new_max_callable', s.new_max_callable, 'new_daily_calls', s.new_daily_calls,
                  'max_callable', s.max_callable, 'daily_calls', s.daily_calls, 'watch_calls', s.watch_calls,
                  'max_attempts', s.max_attempts, 'pause_stop_rate', s.pause_stop_rate, 'pause_min_reached', s.pause_min_reached,
                  'scrub_provider', s.scrub_provider, 'live', coalesce((select reactivation_live from recovery_config limit 1), false),
                  'numbers', (select count(*) from deedstone_numbers where active and pool = 'reactivation')),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'status', l.status, 'agent_id', l.agent_id, 'model', l.model,
               'agent', (select full_name from profiles where id = l.agent_id), 'created_at', l.created_at, 'uploaded', l.uploaded,
               'removed', l.removed, 'callable', l.callable, 'amount_cents', l.amount_cents, 'refunded_cents', l.refunded_cents,
               'paused_at', l.paused_at, 'pause_reason', l.pause_reason, 'pause_kind', l.pause_kind, 'dupes', l.dupes,
               'progress', reactivation_progress(l.id),
               'delivered', (select count(*) from reactivation_deliveries d where d.list_id = l.id and d.status = 'paid'),
               'charged_cents', (select coalesce(sum(d.amount_cents - d.refunded_cents), 0) from reactivation_deliveries d where d.list_id = l.id and d.status in ('paid', 'refunded')),
               'cost_cents', (select coalesce(sum(c.cost_cents), 0) from ai_calls c join reactivation_contacts rc on rc.id = c.reactivation_contact_id
                               where rc.list_id = l.id)) order by l.created_at desc)
               from reactivation_lists l where l.status <> 'cancelled'), '[]'::jsonb),
    -- Each account: calls and their AI cost vs paid deliveries. Many calls and nothing paid = watch (an admin to-do).
    'accounts', coalesce((select jsonb_agg(a order by (a ->> 'watch')::boolean desc, (a ->> 'calls')::int desc) from (
        select jsonb_build_object('agent_id', p.id, 'agent', p.full_name,
          'calls', (select count(*) from ai_calls c where c.agent_id = p.id and c.reactivation_contact_id is not null),
          'cost_cents', (select coalesce(sum(c.cost_cents), 0) from ai_calls c where c.agent_id = p.id and c.reactivation_contact_id is not null),
          'paid', (select count(*) from reactivation_deliveries d where d.agent_id = p.id and d.status = 'paid'),
          'paid_cents', (select coalesce(sum(d.amount_cents - d.refunded_cents), 0) from reactivation_deliveries d where d.agent_id = p.id and d.status in ('paid', 'refunded')),
          'owed', (select count(*) from reactivation_deliveries d where d.agent_id = p.id and d.status = 'failed'),
          'free_rebooks', (select count(*) from reactivation_deliveries d where d.agent_id = p.id and d.status = 'free_rebook'),
          'dupes', (select coalesce(sum(l.dupes), 0) from reactivation_lists l where l.agent_id = p.id and l.status <> 'cancelled'),
          'card', (select jsonb_build_object('status', c.status, 'brand', c.brand, 'last4', c.last4, 'funding', c.funding, 'at', c.checked_at)
                     from reactivation_cards c where c.agent_id = p.id order by c.checked_at desc limit 1),
          'shared_card', exists (select 1 from reactivation_cards c where c.agent_id = p.id and c.status = 'shared'),
          'limits', reactivation_limits(p.id),
          'watch', (select count(*) from ai_calls c where c.agent_id = p.id and c.reactivation_contact_id is not null) >= s.watch_calls
                   and not exists (select 1 from reactivation_deliveries d where d.agent_id = p.id and d.status = 'paid')) as a
          from profiles p
         where exists (select 1 from reactivation_lists l where l.agent_id = p.id and l.status <> 'cancelled')
            or exists (select 1 from reactivation_cards c where c.agent_id = p.id)) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_reactivation_view() from public, anon;
grant execute on function public.admin_reactivation_view() to authenticated;

drop function if exists public.admin_reactivation_settings_save(int, int, int, numeric, int);
create or replace function public.admin_reactivation_settings_save(p_delivered_cents int default null, p_max_attempts int default null,
  p_pause_stop_rate numeric default null, p_pause_min_reached int default null, p_transfer_min_secs int default null,
  p_new_until_paid int default null, p_new_max_callable int default null, p_new_daily_calls int default null,
  p_max_callable int default null, p_daily_calls int default null, p_watch_calls int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update reactivation_settings set delivered_cents = coalesce(p_delivered_cents, delivered_cents), max_attempts = coalesce(p_max_attempts, max_attempts),
         pause_stop_rate = coalesce(p_pause_stop_rate, pause_stop_rate), pause_min_reached = coalesce(p_pause_min_reached, pause_min_reached),
         transfer_min_secs = coalesce(p_transfer_min_secs, transfer_min_secs), new_until_paid = coalesce(p_new_until_paid, new_until_paid),
         new_max_callable = coalesce(p_new_max_callable, new_max_callable), new_daily_calls = coalesce(p_new_daily_calls, new_daily_calls),
         max_callable = coalesce(p_max_callable, max_callable), daily_calls = coalesce(p_daily_calls, daily_calls),
         watch_calls = coalesce(p_watch_calls, watch_calls), updated_at = now(), updated_by = auth.uid()
   where id;
  return (select to_jsonb(s) - 'scrub_provider' from reactivation_settings s where id);
end;
$$;
revoke execute on function public.admin_reactivation_settings_save(int, int, numeric, int, int, int, int, int, int, int, int) from public, anon;
grant execute on function public.admin_reactivation_settings_save(int, int, numeric, int, int, int, int, int, int, int, int) to authenticated;

-- An admin can let a declined delivery go (waive it): the lead shows, nothing is charged, the lists resume.
create or replace function public.admin_reactivation_waive(p_delivery uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d reactivation_deliveries;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update reactivation_deliveries set status = 'waived', updated_at = now() where id = p_delivery and status in ('failed', 'pending') returning * into d;
  if d.id is null then raise exception 'Only an unpaid delivery can be waived' using errcode = '22023'; end if;
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · waived by an admin', 300), updated_at = now()
   where id = d.charge_id and status in ('failed', 'due');
  update leads set reactivated_at = coalesce(reactivated_at, now()), delivered_at = coalesce(delivered_at, now()) where id = d.lead_id;
  perform billing_log(d.agent_id, 'reactivation_waived', null, jsonb_build_object('delivery', d.id), 'Waived by an admin');
  perform reactivation_card_resume(d.agent_id);
  return jsonb_build_object('status', 'waived');
end;
$$;
revoke execute on function public.admin_reactivation_waive(uuid) from public, anon;
grant execute on function public.admin_reactivation_waive(uuid) to authenticated;

-- 267's admin pause sets the kind too (resume clears it).
create or replace function public.admin_reactivation_pause(p_list uuid, p_pause boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare st text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update reactivation_lists set status = case when p_pause then 'paused' else 'working' end,
         paused_at = case when p_pause then now() end, pause_reason = case when p_pause then 'Paused by an admin' end,
         pause_kind = case when p_pause then 'admin' end, updated_at = now()
   where id = p_list and status in ('working', 'paused') returning status into st;
  if st is null then raise exception 'Only a list that is calling or paused' using errcode = '22023'; end if;
  return st;
end;
$$;
revoke execute on function public.admin_reactivation_pause(uuid, boolean) from public, anon;
grant execute on function public.admin_reactivation_pause(uuid, boolean) to authenticated;

-- 267's stop-rate pause marks its kind.
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
    update reactivation_lists set status = 'paused', paused_at = now(), pause_kind = 'stop_rate', updated_at = now(),
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

-- ── 13. Doors: the service-role functions lead-spend, ai-caller and the reactivation function call ──────────────
do $$
declare f text;
begin
  foreach f in array array[
    'reactivation_card_shared(uuid,text)', 'reactivation_card_record(uuid,text,text,text,text,text,text,text)', 'reactivation_card_ok(uuid)',
    'reactivation_limits(uuid)', 'reactivation_start_list(uuid,uuid)', 'reactivation_charge_start(uuid,uuid)', 'reactivation_scrub_done(uuid,jsonb,text)',
    'reactivation_callable(reactivation_contacts,reactivation_lists)', 'reactivation_after_call(uuid,text,timestamptz)', 'reactivation_deliver(uuid,text)',
    'reactivation_bill(uuid)', 'reactivation_transfer_secs(uuid,integer)', 'reactivation_card_resume(uuid)',
    'reactivation_delivery_result(lead_spend_charges,text,text,text)', 'lead_spend_charge_result(uuid,text,text,text)',
    'lead_spend_charge_result_p955(uuid,text,text,text)', 'reactivation_refunds_due()', 'reactivation_delivery_refunded(uuid,integer)',
    'reactivation_text_consent(uuid,boolean)', 'reactivation_texts_claim(integer)', 'reactivation_text_sent(uuid,boolean,text,text)',
    'reactivation_no_show()', 'reactivation_tick()', 'reactivation_list_check(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
