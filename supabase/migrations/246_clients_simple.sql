-- P899 — Clients, simplified: the monthly "Still on the books?" check, Lapsed, fewer fields on Add clients, and the
-- replacement gate opening on "issued" (changes P886's gate). NOT APPLIED: unnumbered, for the backend prompt that
-- wires the agent Clients page to real data. The portal's rules live in src/lib/clientCheck.js; this file applies the
-- same ones on the server (it is the one that counts).
--
-- APPLY ORDER: after p885 (payment_save_deadline), p886 (replacement gate), p888, p891 (book_settings, agent_add_clients).
-- Nothing is dropped, renamed or emptied. Columns the forms stop asking for (policy_number, client_email, face_amount,
-- product_name, effective_date) stay; they are just no longer required.
--
-- FRONTEND CONTRACT
--   policies + check_from date, checked_through date, fixing_reason text (off_books | lapsed | carrier_email),
--             fixing_since date, closed_at timestamptz, old_draft_day smallint, cancel_due_on date
--   book_settings + check_delay_days (0..14, default 3), check_monthly_for (1..36, default 12), check_then_every (1..12, default 3)
--   rpc agent_check_lists(p_today date default null) -> jsonb
--       [{ draft, ask_on, day, clients: [{ policy_id, first_name, last_name, carrier, monthly_premium }] }] oldest first
--   rpc agent_books_check(p_draft date, p_policies uuid[], p_fell_off uuid[] default '{}') -> jsonb { yes, no }
--       every policy in p_policies must owe the check for p_draft. The ones in p_fell_off go to Working (fixing_reason
--       off_books) and the VA gets a lapse_save task due by the end of the next business day.
--   rpc agent_mark_lapsed(p_policy uuid) -> jsonb { ok }   any open client: Working + a lapse_save task.
--   rpc admin_set_check_settings(p_delay int, p_monthly int, p_every int) -> jsonb
--   rpc agent_add_clients(p_rows jsonb, p_ack boolean)  (replaced) rows need first_name, last_name, phone, city, state,
--       carrier, draft_day; monthly_premium and notes optional. Duplicates = the same phone. Same return as p891.
--   replacement_gate_state(p_policy)  (replaced) open once new_issued_on is set; adds old_draft_day, cancel_due_on.

do $$ begin
  if to_regprocedure('public.payment_save_deadline(timestamptz)') is null then raise exception 'p899 needs p885 applied first'; end if;
  if to_regprocedure('public.replacement_gate_state(uuid)') is null then raise exception 'p899 needs p886 applied first'; end if;
  if to_regclass('public.book_settings') is null then raise exception 'p899 needs p891 applied first'; end if;
end $$;

-- ── 1. Columns ─────────────────────────────────────────────────────────────────
alter table public.policies
  add column if not exists check_from      date,
  add column if not exists checked_through date,
  add column if not exists fixing_reason   text check (fixing_reason in ('off_books', 'lapsed', 'carrier_email')),
  add column if not exists fixing_since    date,
  add column if not exists closed_at       timestamptz,
  add column if not exists old_draft_day   smallint check (old_draft_day between 1 and 31),
  add column if not exists cancel_due_on   date;
comment on column public.policies.check_from is 'P899: first day the policy is on the books; the monthly check counts drafts from here.';
comment on column public.policies.checked_through is 'P899: the newest draft date the agent answered "still on the books?" for.';
comment on column public.policies.fixing_reason is 'P899: why the team is working it (agent sees Working). Cleared when the save call ends Saved.';
comment on column public.policies.old_draft_day is 'P899: the draft day of the policy this one replaces; the cancel is due the business day before it.';

alter table public.book_settings
  add column if not exists check_delay_days  int not null default 3  check (check_delay_days between 0 and 14),
  add column if not exists check_monthly_for int not null default 12 check (check_monthly_for between 1 and 36),
  add column if not exists check_then_every  int not null default 3  check (check_then_every between 1 and 12);

-- Existing in-force policies start counting from their effective date (or when they were added).
update public.policies set check_from = coalesce(effective_date, created_at::date)
 where check_from is null and archived_at is null and draft_day is not null;

-- ── 2. The check, in SQL (same rules as lib/clientCheck.js) ──────────────────
-- The draft date in a month: the draft day, or the month's last day when it's shorter.
create or replace function public.client_draft_in(p_month date, p_day int) returns date language sql immutable
set search_path = public as $$
  select least(date_trunc('month', p_month)::date + (p_day - 1),
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
$$;

-- The draft date a policy owes a check for on p_today, or null. Newest checked draft whose ask day has come; null
-- when that one is answered. Draft k (0 = first) is checked when k < monthly_for or (k - (monthly_for - 1)) % then_every = 0.
create or replace function public.client_check_due(p policies, p_today date) returns date language plpgsql stable
set search_path = public as $$
declare
  s record; v_until date; v_d date; v_k int := -1; v_owed date := null; m date;
begin
  if p.draft_day is null or p.check_from is null or p_today is null then return null; end if;
  select check_delay_days, check_monthly_for, check_then_every into s from book_settings limit 1;
  v_until := p_today - coalesce(s.check_delay_days, 3);
  m := date_trunc('month', p.check_from)::date;
  while m <= v_until loop
    v_d := public.client_draft_in(m, p.draft_day);
    if v_d >= p.check_from and v_d <= v_until then
      v_k := v_k + 1;
      if v_k < coalesce(s.check_monthly_for, 12) or (v_k - (coalesce(s.check_monthly_for, 12) - 1)) % coalesce(s.check_then_every, 3) = 0 then
        v_owed := v_d;
      end if;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  if v_owed is null or (p.checked_through is not null and v_owed <= p.checked_through) then return null; end if;
  return v_owed;
end; $$;

-- In force and nothing being fixed: the only clients the check applies to (the rest are Working or Closed).
create or replace function public.client_checkable(p policies) returns boolean language sql stable
set search_path = public as $$
  select p.archived_at is null and p.closed_at is null and p.fixing_reason is null
     and coalesce((select st.stage::text from policy_servicing_status st where st.policy_id = p.id), 'setting_up') in ('protected', 'ongoing')
$$;

create or replace function public.agent_check_lists(p_today date default null) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare v_today date := coalesce(p_today, (now() at time zone 'America/Chicago')::date); v_delay int;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select check_delay_days into v_delay from book_settings limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object('draft', d.draft, 'ask_on', d.draft + coalesce(v_delay, 3), 'day', extract(day from d.draft)::int, 'clients', d.clients) order by d.draft)
      from (select x.draft, jsonb_agg(jsonb_build_object('policy_id', x.id, 'first_name', x.client_first_name, 'last_name', x.client_last_name,
                                                          'carrier', x.carrier_name, 'monthly_premium', x.monthly_premium) order by x.client_last_name) as clients
              from (select p.*, public.client_check_due(p, v_today) as draft from policies p
                     where p.agent_id = auth.uid() and public.client_checkable(p)) x
             where x.draft is not null group by x.draft) d), '[]'::jsonb);
end; $$;
revoke all on function public.agent_check_lists(date) from public, anon;
grant execute on function public.agent_check_lists(date) to authenticated;

-- The save call the VA gets for a No or a Lapsed (lapse_save, due by the end of the next business day).
create or replace function public.client_open_save_call(p policies, p_why text) returns void language plpgsql
security definer set search_path = public as $$
begin
  insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note)
  values (p.agent_id, p.id, 'lapse_save', 'requested', public.payment_save_deadline(now()), 'agent', auth.uid(),
          case p_why when 'lapsed' then 'The agent marked ' || coalesce(p.client_first_name, 'the client') || '''s policy lapsed. Call and get it back on.'
               else 'The agent says ' || coalesce(p.client_first_name, 'the client') || '''s policy is no longer on the books (the '
                    || to_char(p.fixing_since, 'Mon FMDD') || ' draft). Call and save it.' end);
end; $$;
revoke all on function public.client_open_save_call(policies, text) from public, anon, authenticated;

create or replace function public.agent_books_check(p_draft date, p_policies uuid[], p_fell_off uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare p policies%rowtype; v_today date := (now() at time zone 'America/Chicago')::date; v_yes int := 0; v_no int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_draft is null or coalesce(cardinality(p_policies), 0) = 0 then raise exception 'Pick the clients you''re answering for' using errcode = '22004'; end if;
  if exists (select 1 from unnest(coalesce(p_fell_off, '{}')) f where f <> all (p_policies)) then
    raise exception 'A client that fell off isn''t in this list' using errcode = '22023';
  end if;
  for p in select * from policies where id = any (p_policies) for update loop
    if p.agent_id is distinct from auth.uid() then raise exception 'Not your client' using errcode = '42501'; end if;
    if not public.client_checkable(p) or public.client_check_due(p, v_today) is distinct from p_draft then
      raise exception 'That check has moved on. Refresh and try again.' using errcode = '22023';
    end if;
    if p.id = any (coalesce(p_fell_off, '{}')) then
      update policies set checked_through = p_draft, fixing_reason = 'off_books', fixing_since = p_draft where id = p.id returning * into p;
      perform public.client_open_save_call(p, 'off_books');
      v_no := v_no + 1;
    else
      update policies set checked_through = p_draft where id = p.id;
      v_yes := v_yes + 1;
    end if;
  end loop;
  if v_yes + v_no <> cardinality(p_policies) then raise exception 'Client not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('yes', v_yes, 'no', v_no);
end; $$;
revoke all on function public.agent_books_check(date, uuid[], uuid[]) from public, anon;
grant execute on function public.agent_books_check(date, uuid[], uuid[]) to authenticated;

create or replace function public.agent_mark_lapsed(p_policy uuid) returns jsonb language plpgsql
security definer set search_path = public as $$
declare p policies%rowtype; v_today date := (now() at time zone 'America/Chicago')::date; v_due date;
begin
  select * into p from policies where id = p_policy for update;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if p.agent_id is distinct from auth.uid() then raise exception 'Not your client' using errcode = '42501'; end if;
  if p.closed_at is not null or p.archived_at is not null then raise exception 'That client is closed' using errcode = '22023'; end if;
  if p.fixing_reason in ('lapsed', 'off_books') then return jsonb_build_object('ok', true, 'already', true); end if;
  v_due := public.client_check_due(p, v_today);
  update policies set fixing_reason = 'lapsed', fixing_since = v_today, checked_through = coalesce(v_due, checked_through)
   where id = p.id returning * into p;
  perform public.client_open_save_call(p, 'lapsed');
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.agent_mark_lapsed(uuid) from public, anon;
grant execute on function public.agent_mark_lapsed(uuid) to authenticated;

-- A save call that ends Saved clears the Working reason (the client goes back to Protected).
create or replace function public.client_fixing_done() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.kind = 'lapse_save' and new.outcome = 'saved' and old.outcome is distinct from new.outcome then
    update policies set fixing_reason = null, fixing_since = null where id = new.policy_id and fixing_reason is not null;
  end if;
  return new;
end; $$;
drop trigger if exists p899_fixing_done on public.servicing_tasks;
create trigger p899_fixing_done after update of outcome on public.servicing_tasks
  for each row execute function public.client_fixing_done();

create or replace function public.admin_set_check_settings(p_delay int, p_monthly int, p_every int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update book_settings set check_delay_days = p_delay, check_monthly_for = p_monthly, check_then_every = p_every, updated_at = now();
  return (select jsonb_build_object('delay', check_delay_days, 'monthly_for', check_monthly_for, 'then_every', check_then_every) from book_settings limit 1);
end; $$;
revoke all on function public.admin_set_check_settings(int, int, int) from public, anon;
grant execute on function public.admin_set_check_settings(int, int, int) to authenticated;

-- ── 3. Replacement timing (changes p886) ─────────────────────────────────────
-- The old policy's next draft after p_from, and the business day before it (never before p_from).
create or replace function public.replacement_cancel_due(p_old_day int, p_from date) returns date language plpgsql immutable
set search_path = public as $$
declare v_draft date; v_due date;
begin
  if p_old_day is null or p_from is null then return null; end if;
  v_draft := public.client_draft_in(p_from, p_old_day);
  if v_draft <= p_from then v_draft := public.client_draft_in((p_from + interval '1 month')::date, p_old_day); end if;
  v_due := v_draft - 1;
  while extract(isodow from v_due) in (6, 7) loop v_due := v_due - 1; end loop;
  return greatest(v_due, p_from);
end; $$;

-- Closed = the cancel can't happen yet: only "issued" counts now (no wait for the first payment).
create or replace function public.replacement_gate_closed(p policies) returns boolean language sql stable
set search_path = public as $$
  select coalesce((select replacement_gate_on from doc_settings), true)
     and p.replaced_old_policy is true
     and p.replacement_override is null
     and p.new_issued_on is null
$$;

create or replace function public.replacement_gate_state(p_policy uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare p policies%rowtype; v_on boolean; v_applies boolean;
begin
  select * into p from policies where id = p_policy;
  if not found then return null; end if;
  if not (p.agent_id = auth.uid() or public.is_fulfillment() or public.is_admin() or auth.uid() is null) then
    raise exception 'Not your policy' using errcode = '42501';
  end if;
  v_on := coalesce((select replacement_gate_on from doc_settings), true);
  v_applies := v_on and p.replaced_old_policy is true;
  return jsonb_build_object(
    'applies', v_applies,
    'open', not v_applies or p.new_issued_on is not null or p.replacement_override is not null,
    'waiting_for', to_jsonb(case when v_applies and p.replacement_override is null and p.new_issued_on is null then array['issued'] else '{}'::text[] end),
    'issued_on', p.new_issued_on, 'old_draft_day', p.old_draft_day, 'cancel_due_on', p.cancel_due_on,
    'override', p.replacement_override, 'override_at', p.replacement_override_at);
end;
$$;

create or replace function public.policies_replacement_gate() returns trigger language plpgsql
set search_path = public as $$
begin
  if not public.replacement_gate_closed(new) then return new; end if;
  if new.fulfillment_stage::text = 'Complete' and old.fulfillment_stage is distinct from new.fulfillment_stage then
    raise exception 'Not yet: the old policy is cancelled once the new one is issued.'
      using errcode = '22023', hint = 'replacement_gate';
  end if;
  if new.call_live_since is not null and old.call_live_since is null then
    raise exception 'Not yet: the cancel call waits until the new policy is issued.'
      using errcode = '22023', hint = 'replacement_gate';
  end if;
  return new;
end;
$$;

-- When the new policy is issued, the cancel is due the business day before the old policy's next draft, and the
-- open cancel task moves to 5 PM Central that day.
create or replace function public.policies_cancel_due() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.replaced_old_policy is true and new.new_issued_on is not null
     and (old.new_issued_on is distinct from new.new_issued_on or old.old_draft_day is distinct from new.old_draft_day) then
    new.cancel_due_on := public.replacement_cancel_due(new.old_draft_day, new.new_issued_on);
    if new.cancel_due_on is not null then
      update servicing_tasks set due_at = (new.cancel_due_on + time '17:00') at time zone 'America/Chicago'
       where policy_id = new.id and kind in ('cancel_old', 'cancellation') and status not in ('done', 'cancelled');
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists p899_cancel_due on public.policies;
create trigger p899_cancel_due before update of new_issued_on, old_draft_day on public.policies
  for each row execute function public.policies_cancel_due();

-- ── 4. Add clients: the shorter field list ───────────────────────────────────
create or replace function public.agent_add_clients(p_rows jsonb, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent   uuid := auth.uid();
  v_batch   uuid := gen_random_uuid();
  v_skipped jsonb := '[]'::jsonb;
  v_added   int := 0;
  v_seen_ph text[] := '{}';
  r         jsonb;
  v_first text; v_last text; v_phone text; v_city text; v_state text; v_carrier text; v_digits text;
  v_tz text; v_dd int; v_prem numeric; v_line int; v_why text; v_id uuid; v_due timestamptz;
  v_from timestamptz := now();
begin
  if v_agent is null or not exists (select 1 from profiles where id = v_agent and role::text = 'agent' and coalesce(is_active, true)) then
    raise exception 'Only an agent can add clients' using errcode = '42501';
  end if;
  if not coalesce(p_ack, false) then
    raise exception 'Tick that these clients know your client care team may call them' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No clients to add' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'At most 2,000 clients at a time' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_line    := coalesce(nullif(r->>'line', '')::int, v_added + jsonb_array_length(v_skipped) + 1);
    v_first   := nullif(btrim(r->>'first_name'), '');
    v_last    := nullif(btrim(r->>'last_name'), '');
    v_digits  := regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := substr(v_digits, 2); end if;
    v_phone   := case when length(v_digits) = 10 and left(v_digits, 1) <> '1' then '+1' || v_digits end;
    v_city    := nullif(btrim(r->>'city'), '');
    v_state   := upper(nullif(btrim(r->>'state'), ''));
    v_carrier := nullif(btrim(r->>'carrier'), '');
    begin v_dd := (r->>'draft_day')::int; exception when others then v_dd := null; end;
    if v_dd not between 1 and 31 then v_dd := null; end if;
    v_why     := null;

    if v_first is null or v_last is null or v_carrier is null or v_city is null or v_dd is null or coalesce(r->>'phone', '') = '' or v_state is null then
      v_why := 'missing';
    elsif v_phone is null then
      v_why := 'bad_phone';
    elsif v_state !~ '^[A-Z]{2}$' then
      v_why := 'bad_state';
    elsif v_digits = any (v_seen_ph) or exists (select 1 from policies where agent_id = v_agent and archived_at is null
                                                     and right(regexp_replace(coalesce(client_phone, ''), '\D', '', 'g'), 10) = v_digits) then
      v_why := 'duplicate_phone';
    end if;
    if length(v_digits) = 10 then v_seen_ph := v_seen_ph || v_digits; end if;

    if v_why is not null then
      v_skipped := v_skipped || jsonb_build_object('line', v_line, 'why', v_why);
      continue;
    end if;

    begin v_prem := nullif(r->>'monthly_premium', '')::numeric; exception when others then v_prem := null; end;
    if v_prem < 0 then v_prem := null; end if;
    v_tz := nullif(btrim(r->>'time_zone'), '');
    if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := null; end if;

    insert into policies (agent_id, status, source, added_batch_id, client_first_name, client_last_name, client_phone,
                          client_city, state, client_timezone, carrier_name, monthly_premium, draft_day, notes,
                          check_from, fulfillment_assigned, sms_consent)
    values (v_agent, 'In Effect', 'agent_added', v_batch, left(v_first, 80), left(v_last, 80), v_phone,
            left(v_city, 120), v_state, v_tz, left(v_carrier, 120), v_prem, v_dd, left(nullif(btrim(r->>'notes'), ''), 2000),
            (v_from at time zone 'America/Chicago')::date, false, false)
    returning id into v_id;

    v_due := public.book_welcome_due(v_from);
    insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note)
    values (v_agent, v_id, 'welcome_call', 'requested', v_due, 'agent', v_agent,
            'Added by the agent from their own book. Introduce their client care team, check the details, ask about texts.');
    v_added := v_added + 1;
  end loop;

  insert into client_import_batches (id, agent_id, rows_read, added, skipped, ack_text)
  values (v_batch, v_agent, jsonb_array_length(p_rows), v_added, v_skipped,
          'These clients know my client care team may call them about their policy.');
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'skipped', v_skipped);
end; $$;
revoke all on function public.agent_add_clients(jsonb, boolean) from public, anon;
grant execute on function public.agent_add_clients(jsonb, boolean) to authenticated;
