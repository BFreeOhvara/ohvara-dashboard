-- P891 — An agent's existing clients come into servicing: Add client / Import, a welcome call, then serviced like
-- any client (Brayden, Nov 7: "If they have another client wherever, they can have it be serviced… they kind of
-- hand it off to us and we keep track of it").
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it after p885 and p888 (Parallel rule 4). It
-- replaces va_servicing_outcome from p888 whole, with one branch added. Nothing is dropped or emptied.
--
-- FRONTEND CONTRACT
--   rpc agent_add_clients(p_rows jsonb, p_ack boolean) -> jsonb
--       p_rows: [{ first_name, last_name, phone (E.164), email, state, time_zone, carrier, policy_number, product,
--                  face_amount, monthly_premium, draft_day, effective_date (YYYY-MM-DD), notes, line }]  (lib/bookImport)
--       p_ack:  the agent ticked "These clients know my client care team may call them about their policy".
--       Returns { batch_id, added, skipped: [{ line, why }] }. why = missing | duplicate_policy | duplicate_phone |
--       bad_phone | bad_state. Refusals: 42501 not an agent; 22023 no tick, no rows, over 2,000 rows.
--       Each added client: a policies row (source agent_added, status In Effect) and one welcome_call task, due by
--       5 PM Central on the first business day with room (book_settings.welcome_calls_per_day, team-wide).
--   rpc agent_added_clients() -> setof (policy_id, book_status, welcome_due_at, problem, face_amount, draft_day,
--       effective_date). book_status: added | welcomed | serviced | problem. The agent's own only.
--   kind welcome_call, outcomes welcomed | details_fixed | problem | no_answer (va_servicing_outcome).
--       welcomed / details_fixed -> policies.welcomed_at = now().
--       problem   -> policies.welcome_problem = the VA's outcome note (or 'Problem on the welcome call').
--       no_answer -> another welcome_call the next business day; 3 tries in all, then welcome_problem =
--                    'No answer after 3 tries'.
--   rpc va_welcome_text_consent(p_task uuid, p_yes boolean) -> boolean   (VA holding the step, or admin)
--       Yes: one client_text_consents row (script welcome-v1, who, when, task) and policies.sms_consent = true.
--       No: nothing is written. Answered once per task.
--   rpc admin_welcome_backlog() -> jsonb   { per_day, agents: [{ agent_id, agent_name, waiting, due_today, overdue,
--       last_due_at }] }  admin only.
--   table book_settings (one row): welcome_calls_per_day 1..500, default 25. Admins update it.
--
-- Not changed: policy_servicing_status / agent_clients views (an added client reads its stage as before; the agent
-- page shows book_status on top), the cancellation flow (added clients never get fulfillment_assigned), billing.

do $$
begin
  if to_regprocedure('public.payment_save_deadline(timestamptz)') is null then raise exception 'p891 needs p885 applied first'; end if;
  if to_regprocedure('public.admin_payment_emails_to_match()') is null then raise exception 'p891 needs p888 applied first'; end if;
end $$;

-- ── 1. Policies: where the client came from, and the welcome ────────────────
alter table public.policies
  add column if not exists source          text not null default 'ohvara',
  add column if not exists client_email    text,
  add column if not exists face_amount     numeric(12,2),
  add column if not exists draft_day       smallint,
  add column if not exists added_batch_id  uuid,
  add column if not exists welcomed_at     timestamptz,
  add column if not exists welcome_problem text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_source_check') then
    alter table public.policies add constraint policies_source_check check (source in ('ohvara', 'agent_added'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'policies_draft_day_check') then
    alter table public.policies add constraint policies_draft_day_check check (draft_day between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'policies_face_amount_check') then
    alter table public.policies add constraint policies_face_amount_check check (face_amount >= 0);
  end if;
end $$;
comment on column public.policies.source is 'P891: ohvara = sold through Ohvara (Submit); agent_added = an agent brought it in (Add client / Import).';
comment on column public.policies.welcomed_at is 'P891: when the welcome call ended Welcomed or Details fixed. Null for Ohvara sales.';

-- ── 2. Settings: welcome calls a day (team-wide) ────────────────────────────
create table if not exists public.book_settings (
  id                    boolean primary key default true check (id),
  welcome_calls_per_day int not null default 25 check (welcome_calls_per_day between 1 and 500),
  updated_at            timestamptz not null default now()
);
insert into public.book_settings (id) values (true) on conflict (id) do nothing;
alter table public.book_settings enable row level security;
drop policy if exists book_settings_read on public.book_settings;
create policy book_settings_read on public.book_settings for select to authenticated using (true);
drop policy if exists book_settings_admin on public.book_settings;
create policy book_settings_admin on public.book_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.book_settings from public, anon, authenticated;
grant select on public.book_settings to authenticated;
grant update (welcome_calls_per_day, updated_at) on public.book_settings to authenticated;

-- ── 3. Import batches and the consent log ───────────────────────────────────
create table if not exists public.client_import_batches (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  rows_read   int not null,
  added       int not null,
  skipped     jsonb not null default '[]'::jsonb,
  ack_text    text not null,
  created_at  timestamptz not null default now()
);
create index if not exists client_import_batches_agent_idx on public.client_import_batches (agent_id, created_at desc);
alter table public.client_import_batches enable row level security;
drop policy if exists client_import_batches_read on public.client_import_batches;
create policy client_import_batches_read on public.client_import_batches for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());
revoke all on public.client_import_batches from public, anon, authenticated;
grant select on public.client_import_batches to authenticated;

create table if not exists public.client_text_consents (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references public.policies(id) on delete cascade,
  task_id        uuid references public.servicing_tasks(id) on delete set null,
  phone          text,
  script_version text not null,
  said_by        uuid references public.profiles(id) on delete set null,
  said_at        timestamptz not null default now()
);
create unique index if not exists client_text_consents_task_uq on public.client_text_consents (task_id) where task_id is not null;
alter table public.client_text_consents enable row level security;
drop policy if exists client_text_consents_read on public.client_text_consents;
create policy client_text_consents_read on public.client_text_consents for select to authenticated
  using (public.is_admin() or exists (select 1 from public.policies p where p.id = policy_id and p.agent_id = auth.uid()));
revoke all on public.client_text_consents from public, anon, authenticated;
grant select on public.client_text_consents to authenticated;

insert into public.sms_consent_scripts (version, script) values ('welcome-v1',
  'Would you like text updates about your policy at this number, like payment reminders and your review call? Up to 4 a month. Msg & data rates may apply. Reply STOP to stop, HELP for help.')
on conflict (version) do nothing;

-- ── 4. The welcome_call kind and its four results ───────────────────────────
alter table public.servicing_tasks drop constraint servicing_tasks_kind_check;
alter table public.servicing_tasks add constraint servicing_tasks_kind_check
  check (kind in (
    'packet_check', 'review_call', 'chargeback_watch', 'beneficiary_change',
    'address_change', 'payment_change', 'draft_date_change', 'lapse_save',
    'conversion', 'annual_review', 'claim_help', 'carrier_call', 'other', 'welcome_call'
  ));
alter table public.servicing_tasks drop constraint if exists servicing_tasks_outcome_check;
alter table public.servicing_tasks add constraint servicing_tasks_outcome_check check (
  outcome is null or case
    when kind = 'lapse_save' then outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed')
    when kind = 'packet_check' then outcome in ('delivered', 'not_delivered')
    when kind in ('review_call', 'annual_review', 'conversion') then outcome in ('completed', 'not_reached')
    when kind = 'chargeback_watch' then outcome in ('on_time', 'missed')
    when kind = 'welcome_call' then outcome in ('welcomed', 'details_fixed', 'problem', 'no_answer')
    when kind in ('beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
                  'claim_help', 'carrier_call', 'other') then outcome in ('completed', 'could_not_complete')
    else false
  end);
comment on column public.servicing_tasks.outcome is
  'How the step ended, one closed list per kind (206, P888, P891). welcome_call: welcomed, details_fixed, problem, no_answer.';

-- p888's version whole, with the welcome_call branch added.
create or replace function public.va_servicing_outcome(p_task uuid, p_outcome text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_task servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can record an outcome' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;

  v_task := public.servicing_task_for_write(p_task);
  if p_outcome is null or not (case
       -- 'lapsed' stays accepted (the grace ran out) though the VA's picker shows the four call results.
       when v_task.kind = 'lapse_save' then p_outcome in ('saved', 'fixing', 'client_cancelled', 'no_answer', 'lapsed')
       when v_task.kind = 'packet_check' then p_outcome in ('delivered', 'not_delivered')
       when v_task.kind in ('review_call', 'annual_review', 'conversion') then p_outcome in ('completed', 'not_reached')
       when v_task.kind = 'chargeback_watch' then p_outcome in ('on_time', 'missed')
       when v_task.kind = 'welcome_call' then p_outcome in ('welcomed', 'details_fixed', 'problem', 'no_answer')
       else p_outcome in ('completed', 'could_not_complete')
     end) then
    raise exception 'That outcome doesn''t fit this step' using errcode = '22023';
  end if;

  update servicing_tasks set outcome = p_outcome where id = p_task returning * into v_task;

  perform public.servicing_task_log(v_task, 'outcome');
  return v_task.outcome;
end;
$$;
revoke all on function public.va_servicing_outcome(uuid, text) from public, anon;
grant execute on function public.va_servicing_outcome(uuid, text) to authenticated;

-- When the next welcome call is due: 5 PM Central on the first business day after p_from that still has room under
-- the team-wide cap (open welcome calls already due that day count).
create or replace function public.book_welcome_due(p_from timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  v_cap int;
  v_due timestamptz := public.payment_save_deadline(p_from);
  v_n   int;
begin
  select welcome_calls_per_day into v_cap from book_settings where id;
  v_cap := coalesce(v_cap, 25);
  for i in 1..400 loop
    select count(*) into v_n from servicing_tasks
     where kind = 'welcome_call' and status in ('requested', 'scheduled', 'in_progress')
       and (due_at at time zone 'America/Chicago')::date = (v_due at time zone 'America/Chicago')::date;
    exit when v_n < v_cap;
    v_due := public.payment_save_deadline(v_due);
  end loop;
  return v_due;
end; $$;
revoke all on function public.book_welcome_due(timestamptz) from public, anon, authenticated;

-- What a welcome call's result does to the client (fires on the outcome write, like p888's save-call trigger).
create or replace function public.book_welcome_outcome() returns trigger language plpgsql
security definer set search_path = public as $$
declare v_n int;
begin
  if new.kind <> 'welcome_call' or new.outcome is null or new.outcome is not distinct from old.outcome or new.policy_id is null then
    return new;
  end if;
  if new.outcome in ('welcomed', 'details_fixed') then
    update policies set welcomed_at = now(), welcome_problem = null where id = new.policy_id;
  elsif new.outcome = 'problem' then
    update policies set welcome_problem = coalesce(nullif(btrim(new.outcome_note), ''), 'Problem on the welcome call')
     where id = new.policy_id;
  elsif new.outcome = 'no_answer' then
    select count(*) into v_n from servicing_tasks
     where policy_id = new.policy_id and kind = 'welcome_call' and outcome = 'no_answer';
    if v_n >= 3 then
      update policies set welcome_problem = 'No answer after 3 tries' where id = new.policy_id;
    else
      insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note)
      values (new.agent_id, new.policy_id, 'welcome_call', 'requested', public.payment_save_deadline(now()), 'system', auth.uid(),
              'Try again: no answer on the welcome call (try ' || (v_n + 1) || ' of 3).');
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.book_welcome_outcome() from public, anon, authenticated;
drop trigger if exists servicing_tasks_book_welcome on public.servicing_tasks;
create trigger servicing_tasks_book_welcome after update of outcome on public.servicing_tasks
  for each row execute function public.book_welcome_outcome();

-- ── 5. Add client / Import ──────────────────────────────────────────────────
create or replace function public.agent_add_clients(p_rows jsonb, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent   uuid := auth.uid();
  v_batch   uuid := gen_random_uuid();
  v_skipped jsonb := '[]'::jsonb;
  v_added   int := 0;
  v_seen_pn text[] := '{}';
  v_seen_ph text[] := '{}';
  r         jsonb;
  v_first text; v_last text; v_phone text; v_state text; v_carrier text; v_number text; v_pn text; v_digits text;
  v_tz text; v_eff date; v_dd int; v_face numeric; v_prem numeric; v_line int; v_why text; v_id uuid; v_due timestamptz;
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
    v_state   := upper(nullif(btrim(r->>'state'), ''));
    v_carrier := nullif(btrim(r->>'carrier'), '');
    v_number  := nullif(btrim(r->>'policy_number'), '');
    v_pn      := public.payment_norm_policy(v_number);
    v_why     := null;

    if v_first is null or v_last is null or v_carrier is null or v_number is null or coalesce(r->>'phone', '') = '' or v_state is null then
      v_why := 'missing';
    elsif v_phone is null then
      v_why := 'bad_phone';
    elsif v_state !~ '^[A-Z]{2}$' then
      v_why := 'bad_state';
    elsif v_pn = any (v_seen_pn) or exists (select 1 from policies where agent_id = v_agent and archived_at is null
                                                 and public.payment_norm_policy(policy_number) = v_pn) then
      v_why := 'duplicate_policy';
    elsif v_digits = any (v_seen_ph) or exists (select 1 from policies where agent_id = v_agent and archived_at is null
                                                     and right(regexp_replace(coalesce(client_phone, ''), '\D', '', 'g'), 10) = v_digits) then
      v_why := 'duplicate_phone';
    end if;
    if v_pn is not null then v_seen_pn := v_seen_pn || v_pn; end if;
    if length(v_digits) = 10 then v_seen_ph := v_seen_ph || v_digits; end if;

    if v_why is not null then
      v_skipped := v_skipped || jsonb_build_object('line', v_line, 'why', v_why);
      continue;
    end if;

    begin v_eff := (r->>'effective_date')::date; exception when others then v_eff := null; end;
    begin v_dd := (r->>'draft_day')::int; exception when others then v_dd := null; end;
    if v_dd not between 1 and 31 then v_dd := null; end if;
    begin v_face := nullif(r->>'face_amount', '')::numeric; exception when others then v_face := null; end;
    if v_face < 0 then v_face := null; end if;
    begin v_prem := nullif(r->>'monthly_premium', '')::numeric; exception when others then v_prem := null; end;
    if v_prem < 0 then v_prem := null; end if;
    v_tz := nullif(btrim(r->>'time_zone'), '');
    if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := null; end if;

    insert into policies (agent_id, status, source, added_batch_id, client_first_name, client_last_name, client_phone, client_email,
                          state, client_timezone, carrier_name, policy_number, product_name, face_amount, monthly_premium,
                          draft_day, effective_date, notes, fulfillment_assigned, sms_consent)
    values (v_agent, 'In Effect', 'agent_added', v_batch, left(v_first, 80), left(v_last, 80), v_phone,
            left(lower(nullif(btrim(r->>'email'), '')), 200), v_state, v_tz, left(v_carrier, 120), left(v_number, 60),
            left(nullif(btrim(r->>'product'), ''), 120), v_face, v_prem, v_dd, v_eff, left(nullif(btrim(r->>'notes'), ''), 2000),
            false, false)
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

-- The agent's added clients and where each is: added -> welcomed -> serviced (a servicing step done after the
-- welcome); problem wins while welcome_problem is set.
create or replace function public.agent_added_clients()
returns table (policy_id uuid, book_status text, welcome_due_at timestamptz, problem text, face_amount numeric,
               draft_day smallint, effective_date date)
language sql stable security definer set search_path = public as $$
  select p.id,
         case when p.welcome_problem is not null then 'problem'
              when p.welcomed_at is null then 'added'
              when exists (select 1 from servicing_tasks t where t.policy_id = p.id and t.kind <> 'welcome_call'
                              and t.status = 'done' and t.done_at > p.welcomed_at) then 'serviced'
              else 'welcomed' end,
         (select min(t.due_at) from servicing_tasks t where t.policy_id = p.id and t.kind = 'welcome_call'
             and t.status in ('requested', 'scheduled', 'in_progress')),
         p.welcome_problem, p.face_amount, p.draft_day, p.effective_date
    from policies p
   where p.agent_id = auth.uid() and p.source = 'agent_added' and p.archived_at is null
$$;
revoke all on function public.agent_added_clients() from public, anon;
grant execute on function public.agent_added_clients() to authenticated;

-- ── 6. Text updates: only a yes is logged ───────────────────────────────────
create or replace function public.va_welcome_text_consent(p_task uuid, p_yes boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_task servicing_tasks;
  v_phone text;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can record this' using errcode = '42501';
  end if;
  if p_task is null or p_yes is null then
    raise exception 'task and answer are required' using errcode = '22004';
  end if;
  v_task := public.servicing_task_for_write(p_task);
  if v_task.kind <> 'welcome_call' or v_task.policy_id is null then
    raise exception 'Only a welcome call asks about texts' using errcode = '22023';
  end if;
  if exists (select 1 from client_text_consents where task_id = p_task) then
    raise exception 'Already answered on this call' using errcode = '22023';
  end if;
  if not p_yes then
    return false;
  end if;
  select client_phone into v_phone from policies where id = v_task.policy_id;
  insert into client_text_consents (policy_id, task_id, phone, script_version, said_by)
  values (v_task.policy_id, p_task, v_phone, 'welcome-v1', auth.uid());
  update policies set sms_consent = true where id = v_task.policy_id;
  return true;
end; $$;
revoke all on function public.va_welcome_text_consent(uuid, boolean) from public, anon;
grant execute on function public.va_welcome_text_consent(uuid, boolean) to authenticated;

-- ── 7. Admin: how many added clients wait for a welcome, per agent ──────────
create or replace function public.admin_welcome_backlog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'per_day', (select welcome_calls_per_day from book_settings where id),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'agent_name', x.agent_name, 'waiting', x.waiting,
                                          'due_today', x.due_today, 'overdue', x.overdue, 'last_due_at', x.last_due_at)
                       order by x.waiting desc, x.agent_name)
        from (select t.agent_id, coalesce(nullif(btrim(a.full_name), ''), 'Agent') as agent_name,
                     count(*)::int as waiting,
                     count(*) filter (where (t.due_at at time zone 'America/Chicago')::date = v_today)::int as due_today,
                     count(*) filter (where t.due_at < now())::int as overdue,
                     max(t.due_at) as last_due_at
                from servicing_tasks t join profiles a on a.id = t.agent_id
               where t.kind = 'welcome_call' and t.status in ('requested', 'scheduled', 'in_progress')
               group by t.agent_id, a.full_name) x), '[]'::jsonb));
end; $$;
revoke all on function public.admin_welcome_backlog() from public, anon;
grant execute on function public.admin_welcome_backlog() to authenticated;
