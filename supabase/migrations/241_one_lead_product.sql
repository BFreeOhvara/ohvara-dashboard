-- p889_one_lead_product — one lead product: one daily spend per agent, How you take leads (Appointments only, or
-- Appointments + live transfers with live-call hours), and the form/call split behind it that agents never see
-- (Prompt 889; brain/ohvara/How Ohvara Works.md "One lead product", Brayden Nov 7 17:05).
--
-- NOT NUMBERED, NOT APPLIED. Money code, on top of p884_billing_engine (and p880, p881, p882 before it). Brayden
-- numbers and applies it. Same rules as src/lib/leadSplit.js (src/p889.test.js checks the numbers match).
--
-- The model:
--   * The agent sets ONE daily spend (the $50/day paid minimum and the tiers stay, from the price book) and a mode:
--       appts  every lead is booked; all spend goes to form ads.
--       both   during the agent's live-call hours (their own time zone) a ready lead is transferred live; everything
--              else is booked. The spend is split between form ads (agent_lead_spend 'appts') and call ads ('live').
--   * The billing engine (P884) keeps one spend line for the agent: the agent-facing reads (my_billing) show one daily
--     amount and one week total, and the per-type tables become admin-only. The per-type rows stay the engine's
--     internal budgets, and agent_campaign_control gets its budgets from the split (plus the live-call schedule for
--     call ads and the split %) so Jordan's GoHighLevel side reads it per agent.
--   * The split (transfer agents only): starts at lead_split_rules.start_form_pct (70% form / 30% call). Every Monday
--     (lead-split-weekly, 12:00 AM Central, five minutes before the week opens and is charged) it moves toward the
--     side with the lower cost per sale over the last lookback_weeks (4). Under min_sales (5) sales in total it
--     compares cost per show or transfer instead. It moves at most max_step (10) points a week, neither side goes
--     under floor_pct (20), and costs within hold_within (10%) hold. Call ads need call_min_daily_cents ($20) a day;
--     under that all spend goes to form ads. Admin can lock one agent's split. Every Monday decision and every lock
--     is logged (agent_lead_split_log, append-only) with the numbers behind it.
--   * A split change moves budget between the two sides only; the daily total and the money never change, so it
--     never charges. A spend change still goes through lead_spend_set (a raise is charged for the days left).
--
-- Tables: lead_split_rules (one row), agent_lead_product (agent-readable: mode, hours, zone), agent_lead_split
--   (admin only), agent_lead_split_log (admin only, append-only). agent_campaign_control + schedule, split_form_pct.
-- Agent RPCs: lead_product_set, my_billing (now one spend line; the P884 version is kept as my_billing_p884,
--   service role only).
-- Admin RPCs: admin_lead_split_view, admin_lead_split_lock, admin_lead_split_rules_save.
-- Service role / cron: lead_split_weekly (Monday), lead_product_push_all (nightly), lead_split_numbers, lead_split_next,
--   lead_product_resplit, lead_product_push.
-- Owed elsewhere: the lead-spend edge function's set_spend action should call lead_product_set (the agent screens
--   call the RPC directly until then); the lead feed (858 + Jordan) must keep leads.lead_type right per ad side
--   (mortgage_protection = form ads, policy_help = call ads), because the split numbers read leads.inbound_product.

do $$
begin
  if to_regclass('public.agent_campaign_control') is null or to_regprocedure('public.lead_spend_set(integer,integer,uuid)') is null then
    raise exception 'p889 needs p884_billing_engine applied first';
  end if;
  if to_regclass('public.transfer_checks') is null then raise exception 'p889 needs p880 applied first'; end if;
  if to_regclass('public.agent_lead_product') is not null then raise exception 'p889: agent_lead_product already exists'; end if;
end $$;

-- ── 1. The rules (admin setting, one row) ───────────────────────────────────
create table public.lead_split_rules (
  id                    boolean primary key default true check (id),
  start_form_pct        int not null default 70 check (start_form_pct between 0 and 100),
  max_step              int not null default 10 check (max_step between 1 and 50),
  floor_pct             int not null default 20 check (floor_pct between 0 and 50),
  min_sales             int not null default 5 check (min_sales between 0 and 100),
  call_min_daily_cents  int not null default 2000 check (call_min_daily_cents between 0 and 100000),
  hold_within           numeric not null default 0.10 check (hold_within between 0 and 1),
  lookback_weeks        int not null default 4 check (lookback_weeks between 1 and 12),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id) on delete set null,
  check (start_form_pct between floor_pct and 100 - floor_pct)
);
insert into public.lead_split_rules (id) values (true);
alter table public.lead_split_rules enable row level security;
revoke all on public.lead_split_rules from public, anon, authenticated;
grant select on public.lead_split_rules to authenticated;
create policy lsr_admin_read on public.lead_split_rules for select to authenticated using (is_admin());

-- ── 2. How each agent takes leads (agent-readable) ──────────────────────────
create table public.agent_lead_product (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  mode        text not null default 'appts' check (mode in ('appts', 'both')),
  -- { "Mon": { "on": true, "start": "9:00 AM", "end": "5:00 PM" }, ... } on the agent's clock (tz).
  live_hours  jsonb not null default '{}'::jsonb check (jsonb_typeof(live_hours) = 'object'),
  tz          text not null default 'America/Chicago',
  updated_at  timestamptz not null default now()
);
alter table public.agent_lead_product enable row level security;
revoke all on public.agent_lead_product from public, anon, authenticated;
grant select on public.agent_lead_product to authenticated;
create policy alp_read on public.agent_lead_product for select to authenticated using (agent_id = auth.uid() or is_admin());

-- Existing agents: live spend on → Appointments + live transfers, weekday 9-5 in their zone; else Appointments only.
insert into public.agent_lead_product (agent_id, mode, live_hours, tz)
select p.id,
       case when exists (select 1 from agent_lead_spend s where s.agent_id = p.id and s.lead_type = 'live' and s.daily_cents > 0) then 'both' else 'appts' end,
       (select jsonb_object_agg(d, jsonb_build_object('on', d not in ('Sat', 'Sun'), 'start', '9:00 AM', 'end', '5:00 PM'))
          from unnest(array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) d),
       coalesce(nullif(p.timezone, ''), 'America/Chicago')
  from public.profiles p
 where p.role = 'agent'
on conflict do nothing;

-- ── 3. The split (admin only) and its log ───────────────────────────────────
create table public.agent_lead_split (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  form_pct    int not null check (form_pct between 0 and 100),
  locked      boolean not null default false,
  lock_note   text check (char_length(lock_note) <= 500),
  locked_by   uuid references public.profiles(id) on delete set null,
  locked_at   timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.agent_lead_split enable row level security;
revoke all on public.agent_lead_split from public, anon, authenticated;
grant select on public.agent_lead_split to authenticated;
create policy als2_admin_read on public.agent_lead_split for select to authenticated using (is_admin());
insert into public.agent_lead_split (agent_id, form_pct)
select agent_id, (select start_form_pct from lead_split_rules) from public.agent_lead_product on conflict do nothing;

create table public.agent_lead_split_log (
  id          bigint generated always as identity primary key,
  agent_id    uuid references public.profiles(id) on delete cascade, -- null = a rules change
  kind        text not null check (kind in ('weekly', 'lock', 'unlock', 'rules', 'mode')),
  week_start  date,
  before_pct  int,
  after_pct   int,
  reason      text not null,
  numbers     jsonb,
  by_user     uuid references public.profiles(id) on delete set null,
  at          timestamptz not null default now()
);
create index agent_lead_split_log_agent_idx on public.agent_lead_split_log (agent_id, at desc);
alter table public.agent_lead_split_log enable row level security;
revoke all on public.agent_lead_split_log from public, anon, authenticated;
grant select on public.agent_lead_split_log to authenticated;
create policy alsl_admin_read on public.agent_lead_split_log for select to authenticated using (is_admin());
create trigger agent_lead_split_log_block before update or delete on public.agent_lead_split_log
  for each row execute function public.billing_append_only();

-- ── 4. One spend line for agents: the per-type tables become admin-only ─────
-- Agents read their billing through my_billing() (one daily amount, one week total). The per-type rows are the
-- engine's internal budgets and would show the split.
drop policy if exists als_read on public.agent_lead_spend;
create policy als_admin_read on public.agent_lead_spend for select to authenticated using (is_admin());
drop policy if exists lsd_read on public.lead_spend_delivered;
create policy lsd_admin_read on public.lead_spend_delivered for select to authenticated using (is_admin());
drop policy if exists lsl_read on public.lead_spend_ledger;
create policy lsl_admin_read on public.lead_spend_ledger for select to authenticated using (is_admin());
drop policy if exists lsw_read on public.lead_spend_weeks;
create policy lsw_admin_read on public.lead_spend_weeks for select to authenticated using (is_admin());
-- Billing events carry the per-type before/after of spend changes; agents don't read them (my_billing never did).
drop policy if exists abe_read on public.agent_billing_events;
create policy abe_admin_read on public.agent_billing_events for select to authenticated using (is_admin());

-- What GoHighLevel reads per agent (Jordan): the split % and, on the call-ads row, the live-call schedule.
alter table public.agent_campaign_control
  add column if not exists split_form_pct int check (split_form_pct between 0 and 100),
  add column if not exists schedule jsonb check (schedule is null or jsonb_typeof(schedule) = 'object');
comment on column public.agent_campaign_control.schedule is
  'P889: call ads (lead_type live) run only inside these hours: { tz, hours: { Mon: { on, start, end } ... } }. Null = any time.';
comment on column public.agent_campaign_control.split_form_pct is
  'P889: the form share of the agent''s daily spend in effect (100 = Appointments only or under the call minimum).';

-- ── 5. Pure rules (the SQL twin of src/lib/leadSplit.js) ────────────────────
create or replace function public.lead_split_clamp(p_pct int, r lead_split_rules) returns int language sql immutable as $$
  select least(100 - r.floor_pct, greatest(r.floor_pct, p_pct))
$$;

-- What runs from a daily total (cents): { form_cents, call_cents, form_pct, reason }.
create or replace function public.lead_product_split(p_mode text, p_form_pct int, p_daily_cents int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r lead_split_rules; pct int; v_call int; d int := greatest(coalesce(p_daily_cents, 0), 0);
begin
  select * into r from lead_split_rules where id;
  if p_mode is distinct from 'both' then
    return jsonb_build_object('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'appts_only');
  end if;
  pct := lead_split_clamp(coalesce(p_form_pct, r.start_form_pct), r);
  -- Whole dollars, as the screens round them.
  v_call := (round(d * (100 - pct) / 100.0 / 100.0) * 100)::int;
  if v_call < r.call_min_daily_cents then
    return jsonb_build_object('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'call_min');
  end if;
  return jsonb_build_object('form_cents', d - v_call, 'call_cents', v_call, 'form_pct', pct, 'reason', 'split');
end; $$;

-- The Monday move from the numbers (see lead_split_numbers). Returns { form_pct, moved, metric, reason, numbers }.
create or replace function public.lead_split_next(p_form_pct int, p_locked boolean, p_numbers jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r lead_split_rules; cur int; sales int; metric text; f jsonb := p_numbers->'form'; c jsonb := p_numbers->'call';
        cf numeric; cc numeric; nf int; nc int; hi numeric; lo numeric; nxt int; res jsonb;
begin
  select * into r from lead_split_rules where id;
  cur := lead_split_clamp(coalesce(p_form_pct, r.start_form_pct), r);
  sales := coalesce((f->>'sales')::int, 0) + coalesce((c->>'sales')::int, 0);
  metric := case when sales >= r.min_sales then 'sale' else 'early' end;
  nf := case when metric = 'sale' then coalesce((f->>'sales')::int, 0) else coalesce((f->>'shows')::int, 0) + coalesce((f->>'transfers')::int, 0) end;
  nc := case when metric = 'sale' then coalesce((c->>'sales')::int, 0) else coalesce((c->>'shows')::int, 0) + coalesce((c->>'transfers')::int, 0) end;
  -- null = no spend; -1 = spend but nothing back (infinitely expensive).
  cf := case when coalesce((f->>'spent_cents')::int, 0) = 0 then null when nf = 0 then -1 else (f->>'spent_cents')::numeric / nf end;
  cc := case when coalesce((c->>'spent_cents')::int, 0) = 0 then null when nc = 0 then -1 else (c->>'spent_cents')::numeric / nc end;
  res := jsonb_build_object('form_pct', cur, 'moved', 0, 'metric', metric,
           'numbers', p_numbers || jsonb_build_object('sales', sales, 'form_cost_cents', cf, 'call_cost_cents', cc));
  if p_locked then return res || '{"reason":"locked"}'; end if;
  if cf is null or cc is null then return res || '{"reason":"no_spend"}'; end if;
  if cf = -1 and cc = -1 then return res || '{"reason":"no_results"}'; end if;
  if cf <> -1 and cc <> -1 then
    hi := greatest(cf, cc); lo := least(cf, cc);
    if (hi - lo) / hi <= r.hold_within then return res || '{"reason":"even"}'; end if;
  end if;
  -- Cheaper side: a finite cost beats -1; else the lower number.
  nxt := lead_split_clamp(cur + case when cc = -1 or (cf <> -1 and cf < cc) then r.max_step else -r.max_step end, r);
  if nxt = cur then return res || '{"reason":"floor"}'; end if;
  return res || jsonb_build_object('form_pct', nxt, 'moved', nxt - cur,
           'reason', case when nxt > cur then 'form_cheaper' else 'call_cheaper' end);
end; $$;

-- The numbers behind a move, per side, for one agent over [p_from, p_to]:
--   spent_cents  delivered spend (billed + absorbed) per side (lead_spend_delivered: appts = form, live = call)
--   sales        leads with outcome sold
--   shows        booked leads that met the agent (not transferred)
--   transfers    leads with a connected live transfer (Check agent → Yes → picked up), test checks left out
-- Side of a lead: leads.inbound_product (booked_appointment = form ads, live_call = call ads).
create or replace function public.lead_split_numbers(p_agent uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with spend as (
    select lead_type, sum(billed_cents + absorbed_cents)::int cents from lead_spend_delivered
     where agent_id = p_agent and day between p_from and p_to group by lead_type
  ), l as (
    select case when x.inbound_product = 'live_call' then 'call' else 'form' end side, x.outcome, x.inbound_stage,
           exists (select 1 from transfer_checks t where t.lead_id = x.id and t.status = 'connected' and not t.is_test) moved_live
      from leads x
     where x.assigned_rep_id = p_agent and x.inbound_product is not null
       and (x.created_at at time zone 'America/Chicago')::date between p_from and p_to
  ), n as (
    select side, count(*) filter (where outcome = 'sold')::int sales,
           count(*) filter (where not moved_live and (outcome is not null or inbound_stage in ('met', 'sold', 'follow_up')))::int shows,
           count(*) filter (where moved_live)::int transfers
      from l group by side
  )
  select jsonb_build_object('from', p_from, 'to', p_to,
    'form', jsonb_build_object('spent_cents', coalesce((select cents from spend where lead_type = 'appts'), 0),
              'sales', coalesce((select sales from n where side = 'form'), 0), 'shows', coalesce((select shows from n where side = 'form'), 0),
              'transfers', coalesce((select transfers from n where side = 'form'), 0)),
    'call', jsonb_build_object('spent_cents', coalesce((select cents from spend where lead_type = 'live'), 0),
              'sales', coalesce((select sales from n where side = 'call'), 0), 'shows', coalesce((select shows from n where side = 'call'), 0),
              'transfers', coalesce((select transfers from n where side = 'call'), 0)))
$$;

-- ── 6. Applying the split (no money moves) ──────────────────────────────────
-- Tells the engine the split and the call-ads schedule (pending push = pushed_at null or < changed_at, as P884).
create or replace function public.lead_product_push(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare p agent_lead_product; s agent_lead_split; sp jsonb;
begin
  select * into p from agent_lead_product where agent_id = p_agent;
  select * into s from agent_lead_split where agent_id = p_agent;
  sp := lead_product_split(p.mode, s.form_pct, lead_spend_daily_total(p_agent));
  update agent_campaign_control c
     set split_form_pct = (sp->>'form_pct')::int,
         schedule = case when c.lead_type = 'live' and p.mode = 'both' then jsonb_build_object('tz', p.tz, 'hours', p.live_hours) end,
         changed_at = now()
   where c.agent_id = p_agent
     and (c.split_form_pct, c.schedule) is distinct from
         ((sp->>'form_pct')::int, case when c.lead_type = 'live' and p.mode = 'both' then jsonb_build_object('tz', p.tz, 'hours', p.live_hours) end);
end; $$;

-- Re-split today's total (and any pending total from tomorrow) across the two sides, and this week's agreed amounts
-- in the same shares. The daily total, the balance and the charges don't change.
create or replace function public.lead_product_resplit(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare p agent_lead_product; s agent_lead_split; today date := billing_today(); wk date := billing_week_of(billing_today());
        t_now int := lead_spend_daily_total(p_agent, today); nxt_from date; t_next int; a jsonb; b jsonb; agreed int;
begin
  select * into p from agent_lead_product where agent_id = p_agent;
  select * into s from agent_lead_split where agent_id = p_agent;
  if p.agent_id is null then return; end if;
  select min(next_from) into nxt_from from agent_lead_spend where agent_id = p_agent and next_from > today;
  a := lead_product_split(p.mode, s.form_pct, t_now);
  insert into agent_lead_spend (agent_id, lead_type, daily_cents) values (p_agent, 'appts', 0), (p_agent, 'live', 0) on conflict do nothing;
  if nxt_from is not null then
    t_next := lead_spend_daily_total(p_agent, nxt_from);
    b := lead_product_split(p.mode, s.form_pct, t_next);
    update agent_lead_spend set daily_cents = (a->>case lead_type when 'appts' then 'form_cents' else 'call_cents' end)::int,
           next_cents = (b->>case lead_type when 'appts' then 'form_cents' else 'call_cents' end)::int, next_from = nxt_from, updated_at = now()
     where agent_id = p_agent;
  else
    update agent_lead_spend set daily_cents = (a->>case lead_type when 'appts' then 'form_cents' else 'call_cents' end)::int,
           next_cents = null, next_from = null, updated_at = now()
     where agent_id = p_agent;
  end if;
  select agreed_appts + agreed_live into agreed from lead_spend_weeks where agent_id = p_agent and week_start = wk;
  if agreed is not null then
    update lead_spend_weeks
       set agreed_live = (round(agreed * (a->>'call_cents')::numeric / nullif(t_now, 0)))::int,
           agreed_appts = agreed - coalesce((round(agreed * (a->>'call_cents')::numeric / nullif(t_now, 0)))::int, 0)
     where agent_id = p_agent and week_start = wk and t_now > 0;
  end if;
  perform lead_spend_refresh_control(p_agent);
  perform lead_product_push(p_agent);
end; $$;

-- ── 7. The agent sets one daily spend and how they take leads ───────────────
-- p_hours: { Mon: { on, start: 'H:MM AM', end }, ... }; required (at least one day on, end after start) for 'both'.
create or replace function public.lead_product_hours_ok(p_hours jsonb) returns boolean language sql immutable as $$
  select coalesce(bool_or(
           (h.value->>'on')::boolean
           and to_timestamp(h.value->>'end', 'HH:MI AM')::time > to_timestamp(h.value->>'start', 'HH:MI AM')::time), false)
    from jsonb_each(coalesce(p_hours, '{}'::jsonb)) h
   where h.key in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
$$;

create or replace function public.lead_product_set(p_daily_cents int, p_mode text, p_hours jsonb default null, p_tz text default null,
                                                   p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); old agent_lead_product; s agent_lead_split; sp jsonb; res jsonb;
        v_tz text; tomorrow date := billing_today() + 1;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin() then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  if (select role from profiles where id = me) is distinct from 'agent' then raise exception 'Agents only' using errcode = '42501'; end if;
  if p_mode not in ('appts', 'both') then raise exception 'Pick how you take leads' using errcode = '22023'; end if;
  if p_mode = 'both' and not lead_product_hours_ok(p_hours) then
    raise exception 'Set at least one day of live-call hours, or pick Appointments only' using errcode = 'P0001', hint = 'live_hours';
  end if;
  v_tz := coalesce(nullif(p_tz, ''), (select nullif(timezone, '') from profiles where id = me), 'America/Chicago');
  if not exists (select 1 from pg_timezone_names where name = v_tz) then raise exception 'Unknown time zone' using errcode = '22023'; end if;
  select * into old from agent_lead_product where agent_id = me;
  insert into agent_lead_product (agent_id, mode, live_hours, tz) values (me, p_mode, coalesce(p_hours, '{}'::jsonb), v_tz)
  on conflict (agent_id) do update set mode = excluded.mode, live_hours = case when excluded.mode = 'both' then excluded.live_hours else agent_lead_product.live_hours end,
                                       tz = excluded.tz, updated_at = now();
  insert into agent_lead_split (agent_id, form_pct) values (me, (select start_form_pct from lead_split_rules)) on conflict do nothing;
  select * into s from agent_lead_split where agent_id = me;
  if old.mode is distinct from p_mode then
    insert into agent_lead_split_log (agent_id, kind, before_pct, after_pct, reason, numbers, by_user)
    values (me, 'mode', s.form_pct, s.form_pct, 'How they take leads: ' || coalesce(old.mode, 'none') || ' → ' || p_mode, null, auth.uid());
  end if;
  -- The money path (P884): the paid minimum, the raise charge for the days left, the tier from the next bill.
  sp := lead_product_split(p_mode, s.form_pct, p_daily_cents);
  res := lead_spend_set((sp->>'form_cents')::int, (sp->>'call_cents')::int, me);
  -- lead_spend_set split the new total from tomorrow (a change starts at midnight); tell the engine the schedule.
  perform lead_product_push(me);
  return jsonb_build_object('from', coalesce(res->>'from', tomorrow::text), 'daily_cents', p_daily_cents, 'mode', p_mode,
                            'extra_cents', res->'extra_cents', 'charge_id', res->'charge_id', 'tier', res->'tier');
end; $$;

-- ── 8. Every Monday: move each transfer agent's split ───────────────────────
create or replace function public.lead_split_weekly(p_week date default null) returns int language plpgsql
security definer set search_path = public as $$
declare r lead_split_rules; wk date := coalesce(p_week, billing_week_of(billing_today())); a record; nums jsonb; nx jsonb; n int := 0;
begin
  select * into r from lead_split_rules where id;
  for a in select p.agent_id, s.form_pct, s.locked from agent_lead_product p join agent_lead_split s using (agent_id)
            join profiles pr on pr.id = p.agent_id
           where p.mode = 'both' and pr.role = 'agent' loop
    -- Once per agent per week (a re-run is a no-op).
    continue when exists (select 1 from agent_lead_split_log where agent_id = a.agent_id and kind = 'weekly' and week_start = wk);
    nums := lead_split_numbers(a.agent_id, wk - 7 * r.lookback_weeks, wk - 1);
    nx := lead_split_next(a.form_pct, a.locked, nums);
    insert into agent_lead_split_log (agent_id, kind, week_start, before_pct, after_pct, reason, numbers)
    values (a.agent_id, 'weekly', wk, a.form_pct, (nx->>'form_pct')::int, nx->>'reason', nx->'numbers' || jsonb_build_object('metric', nx->>'metric'));
    if (nx->>'moved')::int <> 0 then
      update agent_lead_split set form_pct = (nx->>'form_pct')::int, updated_at = now() where agent_id = a.agent_id;
      perform lead_product_resplit(a.agent_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end; $$;

-- Each night after the daily sweep: the split % and schedule the engine reads follow the spend now in effect.
create or replace function public.lead_product_push_all() returns int language plpgsql security definer set search_path = public as $$
declare a uuid; n int := 0;
begin
  for a in select agent_id from agent_lead_product loop perform lead_product_push(a); n := n + 1; end loop;
  return n;
end; $$;

-- ── 9. Admin ────────────────────────────────────────────────────────────────
create or replace function public.admin_lead_split_view(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare r lead_split_rules; p agent_lead_product; s agent_lead_split; wk date := billing_week_of(billing_today()); nums jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into r from lead_split_rules where id;
  select * into p from agent_lead_product where agent_id = p_agent;
  select * into s from agent_lead_split where agent_id = p_agent;
  nums := lead_split_numbers(p_agent, wk - 7 * r.lookback_weeks, wk - 1);
  return jsonb_build_object(
    'rules', to_jsonb(r), 'product', to_jsonb(p), 'split', to_jsonb(s),
    'daily_cents', lead_spend_daily_total(p_agent),
    'today', lead_product_split(p.mode, s.form_pct, lead_spend_daily_total(p_agent)),
    'next', case when p.mode = 'both' then lead_split_next(s.form_pct, coalesce(s.locked, false), nums) end,
    'controls', (select jsonb_agg(to_jsonb(c)) from agent_campaign_control c where c.agent_id = p_agent),
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from agent_lead_split_log where agent_id = p_agent order by id desc limit 30) l), '[]'::jsonb));
end; $$;

create or replace function public.admin_lead_split_lock(p_agent uuid, p_locked boolean, p_form_pct int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r lead_split_rules; s agent_lead_split; pct int; wk date := billing_week_of(billing_today());
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into r from lead_split_rules where id;
  insert into agent_lead_split (agent_id, form_pct) values (p_agent, r.start_form_pct) on conflict do nothing;
  select * into s from agent_lead_split where agent_id = p_agent;
  pct := coalesce(p_form_pct, s.form_pct);
  if pct <> lead_split_clamp(pct, r) then raise exception 'Neither side can go under % percent', r.floor_pct using errcode = '22023'; end if;
  update agent_lead_split set locked = p_locked, form_pct = pct, lock_note = p_note,
         locked_by = case when p_locked then auth.uid() end, locked_at = case when p_locked then now() end, updated_at = now()
   where agent_id = p_agent;
  insert into agent_lead_split_log (agent_id, kind, week_start, before_pct, after_pct, reason, numbers, by_user)
  values (p_agent, case when p_locked then 'lock' else 'unlock' end, wk, s.form_pct, pct, coalesce(p_note, case when p_locked then 'Locked' else 'Unlocked' end),
          lead_split_numbers(p_agent, wk - 7 * r.lookback_weeks, wk - 1), auth.uid());
  perform lead_product_resplit(p_agent);
  return admin_lead_split_view(p_agent);
end; $$;

create or replace function public.admin_lead_split_rules_save(p_rules jsonb) returns jsonb language plpgsql
security definer set search_path = public as $$
declare before lead_split_rules; after lead_split_rules;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into before from lead_split_rules where id;
  update lead_split_rules set
    start_form_pct = coalesce((p_rules->>'start_form_pct')::int, start_form_pct),
    max_step = coalesce((p_rules->>'max_step')::int, max_step),
    floor_pct = coalesce((p_rules->>'floor_pct')::int, floor_pct),
    min_sales = coalesce((p_rules->>'min_sales')::int, min_sales),
    call_min_daily_cents = coalesce((p_rules->>'call_min_daily_cents')::int, call_min_daily_cents),
    hold_within = coalesce((p_rules->>'hold_within')::numeric, hold_within),
    lookback_weeks = coalesce((p_rules->>'lookback_weeks')::int, lookback_weeks),
    updated_at = now(), updated_by = auth.uid()
  where id returning * into after;
  insert into agent_lead_split_log (agent_id, kind, reason, numbers, by_user)
  values (null, 'rules', 'Split rules changed', jsonb_build_object('before', to_jsonb(before), 'after', to_jsonb(after)), auth.uid());
  return to_jsonb(after);
end; $$;

-- ── 10. The agent's billing read: one spend line ────────────────────────────
alter function public.my_billing() rename to my_billing_p884;
create or replace function public.my_billing() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; t jsonb; p agent_lead_product; nxt date;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v := billing_view(auth.uid(), false);
  t := v->'week'->'types';
  select * into p from agent_lead_product where agent_id = auth.uid();
  select min(next_from) into nxt from agent_lead_spend where agent_id = auth.uid() and next_from is not null;
  return v
    || jsonb_build_object('spend', jsonb_build_object('daily', lead_spend_daily_total(auth.uid()),
                                   'next', case when nxt is not null then lead_spend_daily_total(auth.uid(), nxt) end, 'next_from', nxt))
    || jsonb_build_object('week', (v->'week') - 'types' || jsonb_build_object(
         'agreed_cents', coalesce((t->'appts'->>'agreed_cents')::int, 0) + coalesce((t->'live'->>'agreed_cents')::int, 0),
         'delivered_cents', coalesce((t->'appts'->>'delivered_cents')::int, 0) + coalesce((t->'live'->>'delivered_cents')::int, 0),
         'billed_cents', coalesce((t->'appts'->>'billed_cents')::int, 0) + coalesce((t->'live'->>'billed_cents')::int, 0),
         'absorbed_cents', coalesce((t->'appts'->>'absorbed_cents')::int, 0) + coalesce((t->'live'->>'absorbed_cents')::int, 0)))
    || jsonb_build_object('lead_product', case when p.agent_id is not null then jsonb_build_object('mode', p.mode, 'hours', p.live_hours, 'tz', p.tz) end);
end; $$;

-- ── 11. Grants ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'lead_split_clamp(integer,lead_split_rules)', 'lead_product_split(text,integer,integer)', 'lead_split_next(integer,boolean,jsonb)',
    'lead_split_numbers(uuid,date,date)', 'lead_product_push(uuid)', 'lead_product_resplit(uuid)', 'lead_product_hours_ok(jsonb)',
    'lead_product_set(integer,text,jsonb,text,uuid)', 'lead_split_weekly(date)', 'lead_product_push_all()', 'admin_lead_split_view(uuid)',
    'admin_lead_split_lock(uuid,boolean,integer,text)', 'admin_lead_split_rules_save(jsonb)', 'my_billing()', 'my_billing_p884()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['lead_product_set(integer,text,jsonb,text,uuid)', 'admin_lead_split_view(uuid)',
    'admin_lead_split_lock(uuid,boolean,integer,text)', 'admin_lead_split_rules_save(jsonb)', 'my_billing()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- The P884 read showed the split; only the service role keeps it.
revoke execute on function public.my_billing_p884() from public, anon, authenticated;

-- ── 12. Cron: Monday 12:00 AM Central, before lead-spend-week-open (12:05) opens and charges the week ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('lead-split-weekly', 'lead-product-push');
    perform cron.schedule('lead-split-weekly', '0 6 * * 1', 'select public.lead_split_weekly()');
    perform cron.schedule('lead-product-push', '15 6 * * *', 'select public.lead_product_push_all()');
  end if;
end $$;
