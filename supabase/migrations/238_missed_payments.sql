-- P885 — Missed payments and chargeback warnings (N-E-08; Q37, Q38, Q42).
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it (Parallel rule 4). Additive only: new
-- tables, functions, two triggers, three notification types and one cron job. Nothing is dropped, renamed or
-- emptied; no existing function is replaced.
--
-- APPLY ORDER: after 146/156 (notify), 180/206/212 (servicing_tasks with outcome + watch_month), 145
-- (fulfillment_cron_post, used by the edge function's deploy notes only). Independent of p880/p881/p882.
--
-- How a missed payment comes in (Q37 default: agents forward emails, VAs check portals):
--   1. Forwarded email.  Every agent has their own intake address (pay+<token>@<intake domain>). The agent
--      forwards carrier lapse / missed-payment / NSF emails there (or sets a mail rule). The payment-intake edge
--      function parses each one and calls payment_intake_receive(): matched to a policy → a Payment missed event;
--      not matched or unclear → it waits for a VA to match it by hand (va_payment_intake_match / _dismiss).
--   2. Portal check.     Every 7 days (payment_settings.portal_check_days) each agent gets one check per carrier
--      they have policies with (payment_portal_checks_seed, 6:30 AM Central). A VA looks in that carrier's portal
--      and records what they found (va_portal_check_done). Q38: the VA only LOOKS; anything that needs a change
--      in the portal (re-run a draft, update the bank, a form) goes to the agent as a notification.
--   3. Chargeback watch. The 12 monthly chargeback_watch steps per first-year policy already exist (212). When a
--      VA records one as "Missed a payment", that also becomes a Payment missed event (trigger below).
--
-- What a Payment missed event does (payment_missed_record):
--   - one event per policy per miss (a second report of the same miss, from any source, joins the open one);
--   - opens a lapse-save step for the VAs, due by the end of the next business day (5 PM Central, Mon-Fri), or
--     pulls an already-open lapse save forward to that deadline;
--   - warns the agent at once, at the FIRST missed payment (Q42), as an app notification (push): who, carrier,
--     due date, an estimated grace end, the save-call deadline, "chargeback risk" + month N of 12 when the policy
--     is in its first 12 months, "second miss" when it missed before in the last 12 months;
--   - leaves ghl_pushed_at empty for the client reminder text (D3, GoHighLevel, N-E-58: Jordan reads the open
--     events and stamps it). Nothing is sent from here.
--   The lapse-save result closes it: saved → paid, lapsed → lapsed, client_cancelled → cancelled.
--
-- Owned elsewhere (not built here): grace per carrier + confirm-draft-cleared tasks (N-E-09, 852), chargeback
-- window per carrier (N-E-10, 852), VA progress on the agent's warning (N-E-57, 852), the client text (N-E-58,
-- GoHighLevel). grace_ends_on here is the default estimate (payment_settings.grace_days, 31) until 852.

do $$
begin
  if to_regclass('public.servicing_tasks') is null then raise exception 'p885 needs 180 applied first'; end if;
  if to_regclass('public.notification_types') is null then raise exception 'p885 needs 146 applied first'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'servicing_tasks' and column_name = 'watch_month') then
    raise exception 'p885 needs 212 applied first';
  end if;
end $$;

-- ── 1. Settings ─────────────────────────────────────────────────────────────
create table if not exists public.payment_settings (
  id                 boolean primary key default true check (id),
  intake_domain      text not null default 'in.ohvara.com' check (intake_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  grace_days         int not null default 31 check (grace_days between 0 and 90),
  chargeback_months  int not null default 12 check (chargeback_months between 1 and 24),
  portal_check_days  int not null default 7 check (portal_check_days between 1 and 31),
  same_miss_days     int not null default 20 check (same_miss_days between 0 and 60),
  updated_at         timestamptz not null default now()
);
insert into public.payment_settings (id) values (true) on conflict (id) do nothing;
alter table public.payment_settings enable row level security;
drop policy if exists payment_settings_read on public.payment_settings;
create policy payment_settings_read on public.payment_settings for select to authenticated using (true);
drop policy if exists payment_settings_admin on public.payment_settings;
create policy payment_settings_admin on public.payment_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.payment_settings from public, anon, authenticated;
grant select on public.payment_settings to authenticated;
grant update (intake_domain, grace_days, chargeback_months, portal_check_days, same_miss_days, updated_at)
  on public.payment_settings to authenticated;

-- The end of the next business day after p_from: 5 PM Central, Monday to Friday (no holiday list yet).
create or replace function public.payment_save_deadline(p_from timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((d.day + time '17:00') at time zone 'America/Chicago')
    from (select (p_from at time zone 'America/Chicago')::date + n as day
            from generate_series(1, 7) n) d
   where extract(isodow from d.day) < 6
   order by d.day
   limit 1
$$;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
-- One forwarding address per agent. The token is the only thing that ties an email to an agent.
create table if not exists public.payment_intake_addresses (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  token       text not null unique check (token ~ '^[a-z0-9]{10}$'),
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

-- Every forwarded email the intake took in (the body is kept short; it's there so a VA can match it by hand).
create table if not exists public.payment_intake_emails (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.profiles(id) on delete cascade,
  message_id   text not null check (char_length(message_id) between 1 and 300),
  received_at  timestamptz not null default now(),
  from_addr    text check (char_length(from_addr) <= 300),
  subject      text check (char_length(subject) <= 500),
  body_excerpt text check (char_length(body_excerpt) <= 8000),
  parsed       jsonb not null default '{}'::jsonb,
  notice_kind  text not null check (notice_kind in ('missed', 'lapsed', 'paid', 'other')),
  status       text not null check (status in ('matched', 'unmatched', 'paid_notice', 'not_a_notice')),
  unmatched_why text check (unmatched_why in ('no_policy', 'several_policies', 'unclear')),
  policy_id    uuid references public.policies(id) on delete set null,
  event_id     uuid,
  handled_by   uuid references public.profiles(id) on delete set null,
  handled_at   timestamptz,
  unique (agent_id, message_id)
);
create index if not exists payment_intake_emails_open_idx on public.payment_intake_emails (received_at) where status = 'unmatched';

-- A VA's look in one carrier's portal for one agent (Q38: look only).
create table if not exists public.carrier_portal_checks (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  carrier_name     text not null check (char_length(carrier_name) between 1 and 200),
  policies_count   int not null default 0,
  due_at           timestamptz not null,
  status           text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  result           text check (result in ('nothing_missed', 'missed_found', 'agent_action', 'no_access')),
  missed_count     int not null default 0,
  note             text check (char_length(note) <= 1000),
  agent_action     text check (char_length(agent_action) <= 500),
  done_by          uuid references public.profiles(id) on delete set null,
  done_at          timestamptz,
  created_at       timestamptz not null default now(),
  check ((status = 'done') = (result is not null))
);
create unique index if not exists carrier_portal_checks_open_uidx
  on public.carrier_portal_checks (agent_id, lower(carrier_name)) where status = 'open';
create index if not exists carrier_portal_checks_due_idx on public.carrier_portal_checks (due_at) where status = 'open';

-- One row per missed payment on a policy. The D3 client text (GoHighLevel) reads open rows with
-- ghl_pushed_at null and stamps it.
create table if not exists public.payment_missed_events (
  id               uuid primary key default gen_random_uuid(),
  policy_id        uuid not null references public.policies(id) on delete cascade,
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  due_date         date not null,
  source           text not null check (source in ('email', 'portal_check', 'watch', 'client', 'agent', 'admin')),
  sources          text[] not null default '{}',
  detected_at      timestamptz not null default now(),
  grace_ends_on    date,
  first_year       boolean not null,
  policy_month     smallint check (policy_month between 1 and 600),
  repeat_miss      boolean not null default false,
  lapse_task_id    uuid references public.servicing_tasks(id) on delete set null,
  save_due_at      timestamptz,
  warned_at        timestamptz,
  intake_id        uuid references public.payment_intake_emails(id) on delete set null,
  portal_check_id  uuid references public.carrier_portal_checks(id) on delete set null,
  reported_by      uuid references public.profiles(id) on delete set null,
  note             text check (char_length(note) <= 1000),
  resolved_at      timestamptz,
  resolution       text check (resolution in ('paid', 'lapsed', 'cancelled')),
  ghl_pushed_at    timestamptz,
  unique (policy_id, due_date),
  check ((resolved_at is null) = (resolution is null))
);
create index if not exists payment_missed_events_open_idx on public.payment_missed_events (policy_id) where resolved_at is null;
create index if not exists payment_missed_events_agent_idx on public.payment_missed_events (agent_id, detected_at desc);
create index if not exists payment_missed_events_task_idx on public.payment_missed_events (lapse_task_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_intake_emails_event_fk') then
    alter table public.payment_intake_emails
      add constraint payment_intake_emails_event_fk foreign key (event_id)
      references public.payment_missed_events(id) on delete set null;
  end if;
end $$;

-- Reads: the agent sees their own; Fulfillment and admins see all. No direct writes: only the functions below.
alter table public.payment_intake_addresses enable row level security;
alter table public.payment_intake_emails    enable row level security;
alter table public.carrier_portal_checks    enable row level security;
alter table public.payment_missed_events    enable row level security;
drop policy if exists payment_intake_addresses_read on public.payment_intake_addresses;
create policy payment_intake_addresses_read on public.payment_intake_addresses for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());
drop policy if exists payment_intake_emails_read on public.payment_intake_emails;
create policy payment_intake_emails_read on public.payment_intake_emails for select to authenticated
  using (agent_id = auth.uid() or public.is_fulfillment() or public.is_admin());
drop policy if exists carrier_portal_checks_read on public.carrier_portal_checks;
create policy carrier_portal_checks_read on public.carrier_portal_checks for select to authenticated
  using (agent_id = auth.uid() or public.is_fulfillment() or public.is_admin());
drop policy if exists payment_missed_events_read on public.payment_missed_events;
create policy payment_missed_events_read on public.payment_missed_events for select to authenticated
  using (agent_id = auth.uid() or public.is_fulfillment() or public.is_admin());
revoke all on public.payment_intake_addresses, public.payment_intake_emails, public.carrier_portal_checks,
              public.payment_missed_events from public, anon, authenticated;
grant select on public.payment_intake_addresses, public.payment_intake_emails, public.carrier_portal_checks,
                public.payment_missed_events to authenticated;

-- ── 3. Notifications ────────────────────────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, v.roles, v.label, v.email, 'notify', true, v.push, false, true,
       coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values
    ('payment_missed',           array['agent'],                  'A client missed a payment (chargeback risk)', true,  true,  1),
    ('portal_action_needed',     array['agent'],                  'Something to do in a carrier portal',         true,  true,  2),
    ('payment_intake_unmatched', array['fulfillment', 'admin'],   'A forwarded carrier email needs matching',    false, false, 3)
  ) as v(type, roles, label, email, push, n)
 where not exists (select 1 from public.notification_types t where t.type = v.type);

-- ── 4. The forwarding address ───────────────────────────────────────────────
create or replace function public.payment_intake_token() returns text language sql volatile
set search_path = public as $$
  select substr(translate(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 10)
$$;
revoke all on function public.payment_intake_token() from public, anon, authenticated;

create or replace function public.payment_intake_address_for(p_agent uuid) returns text language plpgsql
security definer set search_path = public as $$
declare v_token text; v_domain text;
begin
  select token into v_token from payment_intake_addresses where agent_id = p_agent;
  if v_token is null then
    insert into payment_intake_addresses (agent_id, token) values (p_agent, payment_intake_token())
    on conflict (agent_id) do nothing;
    select token into v_token from payment_intake_addresses where agent_id = p_agent;
  end if;
  select intake_domain into v_domain from payment_settings where id;
  return 'pay+' || v_token || '@' || coalesce(v_domain, 'in.ohvara.com');
end; $$;
revoke all on function public.payment_intake_address_for(uuid) from public, anon, authenticated;

-- The agent's own address (made the first time they ask). Agents only.
create or replace function public.my_payment_intake_address() returns text language plpgsql
security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role::text = 'agent') then
    raise exception 'Only agents have a forwarding address' using errcode = '42501';
  end if;
  return payment_intake_address_for(auth.uid());
end; $$;
revoke all on function public.my_payment_intake_address() from public, anon;
grant execute on function public.my_payment_intake_address() to authenticated;

-- A new address (the old one stops working at once), e.g. after it leaked.
create or replace function public.rotate_my_payment_intake_address() returns text language plpgsql
security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role::text = 'agent') then
    raise exception 'Only agents have a forwarding address' using errcode = '42501';
  end if;
  perform payment_intake_address_for(auth.uid());
  update payment_intake_addresses set token = payment_intake_token(), rotated_at = now() where agent_id = auth.uid();
  return payment_intake_address_for(auth.uid());
end; $$;
revoke all on function public.rotate_my_payment_intake_address() from public, anon;
grant execute on function public.rotate_my_payment_intake_address() to authenticated;

-- ── 5. The Payment missed event ─────────────────────────────────────────────
create or replace function public.payment_missed_record(
  p_policy uuid, p_due date, p_source text, p_actor uuid default null, p_note text default null,
  p_intake uuid default null, p_portal_check uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  pol        policies%rowtype;
  st         payment_settings%rowtype;
  v_event    uuid;
  v_anchor   date;
  v_month    int;
  v_first    boolean;
  v_repeat   boolean;
  v_grace    date;
  v_deadline timestamptz := payment_save_deadline(now());
  v_task     uuid;
  v_name     text;
  v_how      text;
  v_title    text;
  v_detail   text;
begin
  if p_source not in ('email', 'portal_check', 'watch', 'client', 'agent', 'admin') then
    raise exception 'Unknown source %', p_source using errcode = '22023';
  end if;
  if p_due is null then raise exception 'A due date is needed' using errcode = '22023'; end if;
  select * into pol from policies where id = p_policy for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if pol.agent_id is null then raise exception 'The policy has no agent' using errcode = '22023'; end if;
  select * into st from payment_settings where id;

  -- The same miss reported again (any source): join the open event, don't warn twice.
  select id into v_event from payment_missed_events
   where policy_id = p_policy and resolved_at is null
     and abs(due_date - p_due) <= coalesce(st.same_miss_days, 20)
   order by detected_at limit 1;
  if v_event is null then
    select id into v_event from payment_missed_events where policy_id = p_policy and due_date = p_due;
  end if;
  if v_event is not null then
    update payment_missed_events
       set sources = case when p_source = any(sources) then sources else sources || p_source end,
           intake_id = coalesce(intake_id, p_intake), portal_check_id = coalesce(portal_check_id, p_portal_check)
     where id = v_event;
    return v_event;
  end if;

  v_anchor := coalesce(pol.effective_date, pol.policy_sold_date, pol.created_at::date);
  v_month  := greatest(1, (extract(year from age(p_due, v_anchor)) * 12 + extract(month from age(p_due, v_anchor)))::int + 1);
  v_first  := p_due < (v_anchor + make_interval(months => coalesce(st.chargeback_months, 12)))::date;
  v_repeat := exists (select 1 from payment_missed_events
                       where policy_id = p_policy and due_date between p_due - 366 and p_due - 1);
  v_grace  := p_due + coalesce(st.grace_days, 31);
  v_name   := nullif(trim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), '');
  v_how    := case p_source when 'email' then 'from your forwarded carrier email' when 'portal_check' then 'found in the carrier portal'
                when 'watch' then 'found on the monthly payment check' when 'client' then 'the client told us'
                when 'agent' then 'you told us' else 'reported by the Ohvara team' end;

  insert into payment_missed_events (policy_id, agent_id, due_date, source, sources, grace_ends_on, first_year, policy_month,
                                     repeat_miss, save_due_at, intake_id, portal_check_id, reported_by, note)
  values (p_policy, pol.agent_id, p_due, p_source, array[p_source], v_grace, v_first, least(v_month, 600),
          v_repeat, v_deadline, p_intake, p_portal_check, p_actor, left(p_note, 1000))
  returning id into v_event;

  -- The lapse-save step: reuse an open one (pulled forward to the deadline), else open one.
  select id into v_task from servicing_tasks
   where policy_id = p_policy and kind = 'lapse_save' and status in ('requested', 'scheduled', 'in_progress')
   order by created_at limit 1;
  if v_task is not null then
    update servicing_tasks set due_at = least(coalesce(due_at, v_deadline), v_deadline) where id = v_task;
  else
    insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note)
    values (pol.agent_id, p_policy, 'lapse_save', 'requested', v_deadline, 'system', p_actor,
            left('Payment missed: due ' || to_char(p_due, 'Mon FMDD') || ' (' || v_how || ').'
                 || ' Grace ends about ' || to_char(v_grace, 'Mon FMDD') || '.'
                 || case when v_first then ' First year: chargeback risk, month ' || least(v_month, 12) || ' of '
                      || coalesce(st.chargeback_months, 12) || '.' else '' end
                 || case when v_repeat then ' Second miss in 12 months.' else '' end
                 || ' Call the client; any change in the carrier portal goes to the agent.', 1000))
    returning id into v_task;
  end if;
  update payment_missed_events set lapse_task_id = v_task where id = v_event;

  -- Q42: warn the agent at the first missed payment.
  v_title := case when v_first then 'Chargeback risk: ' else '' end || coalesce(v_name, 'A client') || ' missed a payment';
  v_detail := case when v_repeat then 'Second missed payment in 12 months. ' else '' end
           || coalesce(pol.carrier_name, 'The carrier') || ': the payment due ' || to_char(p_due, 'Mon FMDD')
           || ' didn''t go through (' || v_how || '). Grace ends about ' || to_char(v_grace, 'Mon FMDD') || '. '
           || 'A VA calls ' || coalesce(pol.client_first_name, 'them') || ' by '
           || to_char(v_deadline at time zone 'America/Chicago', 'Dy FMHH12 AM') || ' Central to save it.'
           || case when v_first then ' Month ' || least(v_month, 12) || ' of ' || coalesce(st.chargeback_months, 12)
                || ' on the chargeback watch.' else '' end;
  perform public.notify(pol.agent_id, 'payment_missed', v_title, v_detail, '/agent/clients', true,
                        'payment_missed:' || v_event,
                        jsonb_build_object('policy_id', p_policy, 'event_id', v_event, 'task_id', v_task,
                                           'first_year', v_first, 'repeat', v_repeat));
  update payment_missed_events set warned_at = now() where id = v_event;
  return v_event;
end; $$;
revoke all on function public.payment_missed_record(uuid, date, text, uuid, text, uuid, uuid) from public, anon, authenticated;

-- An admin, or the policy's agent, reports a miss by hand (the client told them, a letter came).
create or replace function public.report_payment_missed(p_policy uuid, p_due date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_agent uuid;
begin
  select agent_id into v_agent from policies where id = p_policy;
  if v_agent is null then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if public.is_admin() then
    return payment_missed_record(p_policy, p_due, 'admin', auth.uid(), p_note);
  elsif v_agent = auth.uid() then
    return payment_missed_record(p_policy, p_due, 'agent', auth.uid(), p_note);
  elsif public.is_fulfillment() then
    return payment_missed_record(p_policy, p_due, 'client', auth.uid(), p_note);
  end if;
  raise exception 'Not your policy' using errcode = '42501';
end; $$;
revoke all on function public.report_payment_missed(uuid, date, text) from public, anon;
grant execute on function public.report_payment_missed(uuid, date, text) to authenticated;

-- ── 6. Forwarded email intake (called by the payment-intake edge function, service role) ─
create or replace function public.payment_norm_policy(p text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function public.payment_intake_receive(
  p_token text, p_message_id text, p_from text, p_subject text, p_body text, p_parsed jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent   uuid;
  v_intake  uuid;
  v_kind    text := coalesce(p_parsed->>'kind', 'other');
  v_number  text := payment_norm_policy(p_parsed->>'policy_number');
  v_client  text := lower(trim(regexp_replace(coalesce(p_parsed->>'client_name', ''), '\s+', ' ', 'g')));
  v_due     date;
  v_policy  uuid;
  v_hits    int := 0;
  v_why     text;
  v_event   uuid;
  v_status  text;
  r         record;
begin
  select agent_id into v_agent from payment_intake_addresses where token = lower(p_token);
  if v_agent is null then return jsonb_build_object('status', 'unknown_address'); end if;
  if v_kind not in ('missed', 'lapsed', 'paid', 'other') then v_kind := 'other'; end if;
  if coalesce(p_message_id, '') = '' then raise exception 'message_id is needed' using errcode = '22023'; end if;

  select id, status, event_id into r from payment_intake_emails where agent_id = v_agent and message_id = left(p_message_id, 300);
  if found then return jsonb_build_object('status', 'duplicate', 'intake_id', r.id, 'event_id', r.event_id); end if;

  begin v_due := (p_parsed->>'due_date')::date; exception when others then v_due := null; end;

  -- Match: the policy number first, then the insured's name (only when exactly one policy fits).
  if v_number is not null then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null and payment_norm_policy(policy_number) = v_number;
  end if;
  if coalesce(v_hits, 0) = 0 and v_client <> '' then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null
       and (lower(trim(coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, ''))) = v_client
         or lower(trim(coalesce(client_last_name, '') || ', ' || coalesce(client_first_name, ''))) = v_client);
  end if;
  if coalesce(v_hits, 0) <> 1 then v_policy := null; end if;
  v_why := case when v_kind = 'other' then 'unclear' when coalesce(v_hits, 0) > 1 then 'several_policies'
                when v_policy is null then 'no_policy' end;

  v_status := case when v_kind = 'paid' then 'paid_notice'
                   when v_kind in ('missed', 'lapsed') and v_policy is not null then 'matched'
                   else 'unmatched' end;
  insert into payment_intake_emails (agent_id, message_id, from_addr, subject, body_excerpt, parsed, notice_kind, status,
                                     unmatched_why, policy_id)
  values (v_agent, left(p_message_id, 300), left(p_from, 300), left(p_subject, 500), left(p_body, 8000),
          coalesce(p_parsed, '{}'::jsonb), v_kind, v_status, case when v_status = 'unmatched' then v_why end, v_policy)
  returning id into v_intake;

  if v_status = 'matched' then
    v_event := payment_missed_record(v_policy, coalesce(v_due, (now() at time zone 'America/Chicago')::date), 'email',
                                     null, left(p_subject, 300), v_intake);
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'paid_notice' and v_policy is not null then
    -- A "payment received" email closes an open miss on that policy.
    update payment_missed_events set resolved_at = now(), resolution = 'paid'
     where policy_id = v_policy and resolved_at is null
     returning id into v_event;
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'unmatched' then
    for r in select id from profiles where role::text = 'fulfillment' and coalesce(is_active, true) loop
      perform public.notify(r.id, 'payment_intake_unmatched', 'A forwarded carrier email needs matching',
                            coalesce(left(p_subject, 140), 'No subject') || case v_why when 'several_policies' then ' (fits more than one policy)'
                              when 'unclear' then ' (not clear it''s a missed payment)' else ' (no policy found)' end,
                            '/fulfillment/servicing', true, 'payment_intake:' || v_intake || ':' || r.id);
    end loop;
  end if;
  return jsonb_build_object('status', v_status, 'intake_id', v_intake, 'event_id', v_event, 'why', v_why);
end; $$;
revoke all on function public.payment_intake_receive(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_intake_receive(text, text, text, text, text, jsonb) to service_role;

-- A VA matches a waiting email to one of that agent's policies.
create or replace function public.va_payment_intake_match(p_intake uuid, p_policy uuid, p_due date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e payment_intake_emails%rowtype; v_event uuid;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can match an email' using errcode = '42501';
  end if;
  select * into e from payment_intake_emails where id = p_intake for update;
  if not found then raise exception 'Email not found' using errcode = 'P0002'; end if;
  if e.status <> 'unmatched' then raise exception 'This email is already handled' using errcode = '22023'; end if;
  if not exists (select 1 from policies where id = p_policy and agent_id = e.agent_id) then
    raise exception 'That policy isn''t this agent''s' using errcode = '42501';
  end if;
  v_event := payment_missed_record(p_policy,
               coalesce(p_due, (e.parsed->>'due_date')::date, (e.received_at at time zone 'America/Chicago')::date),
               'email', auth.uid(), left(e.subject, 300), p_intake);
  update payment_intake_emails set status = 'matched', unmatched_why = null, policy_id = p_policy, event_id = v_event,
         handled_by = auth.uid(), handled_at = now() where id = p_intake;
  return v_event;
end; $$;
revoke all on function public.va_payment_intake_match(uuid, uuid, date) from public, anon;
grant execute on function public.va_payment_intake_match(uuid, uuid, date) to authenticated;

-- Not a missed-payment email (a newsletter, a statement): set it aside.
create or replace function public.va_payment_intake_dismiss(p_intake uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can set an email aside' using errcode = '42501';
  end if;
  update payment_intake_emails set status = 'not_a_notice', handled_by = auth.uid(), handled_at = now()
   where id = p_intake and status = 'unmatched';
  if not found then raise exception 'Email not found or already handled' using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.va_payment_intake_dismiss(uuid) from public, anon;
grant execute on function public.va_payment_intake_dismiss(uuid) to authenticated;

-- ── 7. Carrier portal checks (Q38: the VA looks; the agent acts) ────────────
create or replace function public.payment_portal_checks_seed() returns int language plpgsql
security definer set search_path = public as $$
declare v_days int; v_n int;
begin
  select portal_check_days into v_days from payment_settings where id;
  with books as (
    select p.agent_id, mode() within group (order by trim(p.carrier_name)) as carrier_name, count(*)::int as n
      from policies p join profiles a on a.id = p.agent_id
     where p.archived_at is null and coalesce(p.is_sample, false) = false and coalesce(p.is_demo, false) = false
       and p.status in ('Submitted', 'In Effect', 'Undrafted')
       and nullif(trim(p.carrier_name), '') is not null
       and a.role::text = 'agent' and coalesce(a.is_active, true)
     group by p.agent_id, lower(trim(p.carrier_name))
  ), due as (
    select b.* from books b
     where not exists (select 1 from carrier_portal_checks c
                        where c.agent_id = b.agent_id and lower(c.carrier_name) = lower(b.carrier_name)
                          and (c.status = 'open' or (c.status = 'done' and c.done_at > now() - make_interval(days => coalesce(v_days, 7)) + interval '12 hours')))
  ), ins as (
    insert into carrier_portal_checks (agent_id, carrier_name, policies_count, due_at)
    select agent_id, carrier_name, n, payment_save_deadline(now() - interval '1 day') from due
    on conflict do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end; $$;
revoke all on function public.payment_portal_checks_seed() from public, anon, authenticated;

-- p_missed: [{"policy_id": "...", "due_date": "2026-11-03"}, ...] (only with missed_found).
create or replace function public.va_portal_check_done(
  p_check uuid, p_result text, p_note text default null, p_missed jsonb default '[]'::jsonb, p_agent_action text default null
) returns int language plpgsql security definer set search_path = public as $$
declare c carrier_portal_checks%rowtype; m jsonb; v_pol uuid; v_due date; v_n int := 0; v_title text;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can record a portal check' using errcode = '42501';
  end if;
  select * into c from carrier_portal_checks where id = p_check for update;
  if not found then raise exception 'Check not found' using errcode = 'P0002'; end if;
  if c.status <> 'open' then raise exception 'This check is already done' using errcode = '22023'; end if;
  if p_result not in ('nothing_missed', 'missed_found', 'agent_action', 'no_access') then
    raise exception 'Unknown result %', p_result using errcode = '22023';
  end if;
  if p_result in ('agent_action', 'no_access') and nullif(trim(coalesce(p_agent_action, '')), '') is null then
    raise exception 'Say what the agent needs to do' using errcode = '22023';
  end if;
  if p_result = 'missed_found' and coalesce(jsonb_array_length(p_missed), 0) = 0 then
    raise exception 'Pick the policy that missed a payment' using errcode = '22023';
  end if;

  if p_result = 'missed_found' then
    for m in select * from jsonb_array_elements(p_missed) loop
      v_pol := (m->>'policy_id')::uuid;
      v_due := (m->>'due_date')::date;
      if not exists (select 1 from policies where id = v_pol and agent_id = c.agent_id
                       and lower(trim(carrier_name)) = lower(c.carrier_name)) then
        raise exception 'That policy isn''t with % for this agent', c.carrier_name using errcode = '42501';
      end if;
      perform payment_missed_record(v_pol, v_due, 'portal_check', auth.uid(), p_note, null, p_check);
      v_n := v_n + 1;
    end loop;
  end if;

  -- Q38: anything to change in the portal is the agent's to do.
  if nullif(trim(coalesce(p_agent_action, '')), '') is not null then
    v_title := case when p_result = 'no_access' then 'We couldn''t check your ' || c.carrier_name || ' portal'
                    else 'Something to do in your ' || c.carrier_name || ' portal' end;
    perform public.notify(c.agent_id, 'portal_action_needed', v_title, left(trim(p_agent_action), 500), '/agent/clients', true,
                          'portal_action:' || c.id, jsonb_build_object('check_id', c.id, 'carrier', c.carrier_name));
  end if;

  update carrier_portal_checks set status = 'done', result = p_result, missed_count = v_n, note = left(p_note, 1000),
         agent_action = left(nullif(trim(coalesce(p_agent_action, '')), ''), 500), done_by = auth.uid(), done_at = now()
   where id = p_check;
  return v_n;
end; $$;
revoke all on function public.va_portal_check_done(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.va_portal_check_done(uuid, text, text, jsonb, text) to authenticated;

-- ── 8. Wiring into the existing servicing steps ─────────────────────────────
-- A chargeback-watch month recorded as "Missed a payment" is a Payment missed event; a lapse-save result closes it.
create or replace function public.payment_servicing_outcome() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.outcome is null or new.outcome is not distinct from old.outcome then return new; end if;
  if new.kind = 'chargeback_watch' and new.outcome = 'missed' and new.policy_id is not null then
    perform payment_missed_record(new.policy_id,
              coalesce((new.due_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date),
              'watch', auth.uid(), new.outcome_note);
  elsif new.kind = 'lapse_save' then
    update payment_missed_events
       set resolved_at = now(),
           resolution = case new.outcome when 'saved' then 'paid' when 'lapsed' then 'lapsed' else 'cancelled' end
     where lapse_task_id = new.id and resolved_at is null;
  end if;
  return new;
end; $$;
revoke all on function public.payment_servicing_outcome() from public, anon, authenticated;
drop trigger if exists payment_servicing_outcome on public.servicing_tasks;
create trigger payment_servicing_outcome after update of outcome on public.servicing_tasks
  for each row execute function public.payment_servicing_outcome();

-- ── 9. Reads for the screens ────────────────────────────────────────────────
-- The VA desk: waiting emails, open portal checks, open misses. Fulfillment and admins.
create or replace function public.va_missed_payment_desk() returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the missed-payment desk' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'agent_id', e.agent_id, 'agent', a.full_name,
                 'received_at', e.received_at, 'from', e.from_addr, 'subject', e.subject, 'excerpt', left(e.body_excerpt, 600),
                 'parsed', e.parsed, 'why', e.unmatched_why) order by e.received_at)
              from payment_intake_emails e join profiles a on a.id = e.agent_id where e.status = 'unmatched'), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'agent_id', c.agent_id, 'agent', a.full_name,
                 'carrier', c.carrier_name, 'policies', c.policies_count, 'due_at', c.due_at) order by c.due_at)
              from carrier_portal_checks c join profiles a on a.id = c.agent_id where c.status = 'open'), '[]'::jsonb),
    'misses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'policy_id', m.policy_id, 'agent_id', m.agent_id,
                 'client', trim(coalesce(p.client_first_name, '') || ' ' || coalesce(p.client_last_name, '')),
                 'carrier', p.carrier_name, 'due_date', m.due_date, 'grace_ends_on', m.grace_ends_on,
                 'first_year', m.first_year, 'policy_month', m.policy_month, 'repeat', m.repeat_miss,
                 'task_id', m.lapse_task_id, 'save_due_at', m.save_due_at, 'sources', m.sources) order by m.save_due_at)
              from payment_missed_events m join policies p on p.id = m.policy_id where m.resolved_at is null), '[]'::jsonb));
end; $$;
revoke all on function public.va_missed_payment_desk() from public, anon;
grant execute on function public.va_missed_payment_desk() to authenticated;

-- ── 10. Cron ────────────────────────────────────────────────────────────────
-- 12:30 UTC = 6:30 AM Central (CST) / 7:30 AM (CDT): the day's portal checks are on the VA desk before the shift.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'payment-portal-checks';
    perform cron.schedule('payment-portal-checks', '30 12 * * 1-5', 'select public.payment_portal_checks_seed()');
  end if;
end $$;
