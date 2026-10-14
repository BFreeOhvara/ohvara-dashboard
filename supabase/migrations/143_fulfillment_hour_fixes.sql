-- Prompt 761 — Admin Payouts: "Fix hours".
--
-- A Fulfillment person's pay week still comes from their schedule
-- (fulfillment_pay, migration 138), but an admin can now correct a day's
-- hours before approving. Every correction is a row in
-- fulfillment_hour_fixes (append-only: who, when, why, before → after); the
-- newest row for a day wins. fulfillment_week_figures, and so the amount
-- fulfillment-pay-week sends, uses it.
--
--   fulfillment_week_days(rep, monday)   per-day hours for the strip: what the
--                                        schedule gives, the fix if any, and the
--                                        hours that count
--   fulfillment_week_figures             now sums fulfillment_week_days (same
--                                        signature and results when no fixes)
--   fulfillment_fix_hours(rep, monday, days, reason)
--                                        admin only; refused once the week is
--                                        approved or paid; writes one audit row
--                                        per changed day and refreshes the
--                                        week's row in fulfillment_payouts

create table if not exists public.fulfillment_hour_fixes (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null check (extract(isodow from period_start) = 1),
  day           date not null check (day between period_start and period_start + 6),
  before_hours  numeric(5,2) not null,
  after_hours   numeric(5,2) not null check (after_hours between 0 and 24),
  reason        text not null check (length(btrim(reason)) between 3 and 500),
  changed_by    uuid not null references public.profiles(id),
  -- clock_timestamp, not now(): two fixes in one transaction must still order.
  changed_at    timestamptz not null default clock_timestamp()
);
create index if not exists fulfillment_hour_fixes_day_idx
  on public.fulfillment_hour_fixes (rep_id, day, changed_at desc);

alter table public.fulfillment_hour_fixes enable row level security;
drop policy if exists fhf_admin_select on public.fulfillment_hour_fixes;
create policy fhf_admin_select on public.fulfillment_hour_fixes
  for select using (public.is_admin());
-- No insert/update/delete for anyone: rows are written only by
-- fulfillment_fix_hours (security definer) and never changed.
revoke all on public.fulfillment_hour_fixes from anon, authenticated;
grant select on public.fulfillment_hour_fixes to authenticated;

-- ── per-day hours ───────────────────────────────────────────────────────────
create or replace function public.fulfillment_week_days(p_rep uuid, p_start date, p_now timestamptz default now())
returns table (day date, scheduled numeric, fixed numeric, hours numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz   text;
  v_pay  public.fulfillment_pay;
  v_day  date;
  v_from timestamptz;
  v_to   timestamptz;
  v_fix  numeric;
begin
  if auth.uid() is not null and p_rep is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if extract(isodow from p_start) <> 1 then
    raise exception 'A pay week starts on a Monday' using errcode = '22023';
  end if;

  select coalesce(timezone, 'America/Chicago') into v_tz from profiles where id = p_rep;
  if not found then return; end if;
  select * into v_pay from fulfillment_pay where profile_id = p_rep;

  for i in 0..6 loop
    v_day := p_start + i;
    scheduled := 0;
    if v_pay.shift_start is not null and extract(isodow from v_day)::smallint = any (v_pay.shift_days) then
      v_from := (v_day + v_pay.shift_start) at time zone v_tz;
      v_to   := (v_day + v_pay.shift_end)   at time zone v_tz;
      scheduled := greatest(0, extract(epoch from least(v_to, p_now) - v_from)) / 3600;
    end if;
    select f.after_hours into v_fix from fulfillment_hour_fixes f
      where f.rep_id = p_rep and f.day = v_day
      order by f.changed_at desc, f.id desc limit 1;
    day   := v_day;
    fixed := v_fix;   -- null when not found
    hours := coalesce(v_fix, scheduled);
    scheduled := round(scheduled, 2);
    return next;
    v_fix := null;
  end loop;
end;
$$;

-- Same contract as migration 138; the hours are now the per-day sum.
create or replace function public.fulfillment_week_figures(p_rep uuid, p_start date, p_now timestamptz default now())
returns table (period_start date, period_end date, hours numeric, rate_cents integer, amount_cents integer, ended boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_rate  integer;
  v_hours numeric;
begin
  if auth.uid() is not null and p_rep is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if extract(isodow from p_start) <> 1 then
    raise exception 'A pay week starts on a Monday' using errcode = '22023';
  end if;

  select coalesce(timezone, 'America/Chicago') into v_tz from profiles where id = p_rep;
  if not found then return; end if;
  select hourly_rate_cents into v_rate from fulfillment_pay where profile_id = p_rep;
  select coalesce(sum(d.hours), 0) into v_hours from public.fulfillment_week_days(p_rep, p_start, p_now) d;

  period_start := p_start;
  period_end   := p_start + 6;
  hours        := round(v_hours, 2);
  rate_cents   := coalesce(v_rate, 0);
  amount_cents := round(v_hours * coalesce(v_rate, 0))::integer;
  ended        := p_now >= ((p_start + 7)::timestamp at time zone v_tz);
  return next;
end;
$$;

-- ── Fix hours ───────────────────────────────────────────────────────────────
-- p_days: {"2026-10-05": 7.5, ...}; only days of that week, 0–24 hours.
-- Days whose hours don't change are skipped (no audit row).
create or replace function public.fulfillment_fix_hours(p_rep uuid, p_start date, p_days jsonb, p_reason text)
returns table (period_start date, hours numeric, amount_cents integer, changed integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_role   text;
  k        text;
  v_day    date;
  v_after  numeric;
  v_before numeric;
  n        integer := 0;
  f        record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can fix hours' using errcode = '42501';
  end if;
  if extract(isodow from p_start) <> 1 then
    raise exception 'A pay week starts on a Monday' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Say why the hours changed' using errcode = '22023';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'object' then
    raise exception 'No days to change' using errcode = '22023';
  end if;
  select role into v_role from profiles where id = p_rep;
  if v_role is distinct from 'fulfillment' then
    raise exception 'That person isn''t on Fulfillment' using errcode = '22023';
  end if;

  -- Lock the week's row (if any) so an approve can't slip in between.
  select status into v_status from fulfillment_payouts
    where rep_id = p_rep and fulfillment_payouts.period_start = p_start for update;
  if v_status in ('approved', 'paid') then
    raise exception 'That week is already approved, so its hours can''t change' using errcode = 'P0001';
  end if;

  for k in select jsonb_object_keys(p_days) loop
    begin
      v_day := k::date;
      v_after := round((p_days ->> k)::numeric, 2);
    exception when others then
      raise exception 'Bad day or hours: %', k using errcode = '22023';
    end;
    if v_day < p_start or v_day > p_start + 6 then
      raise exception '% isn''t in that week', v_day using errcode = '22023';
    end if;
    if v_after is null or v_after < 0 or v_after > 24 then
      raise exception 'Hours for % must be 0 to 24', v_day using errcode = '22023';
    end if;
    select round(d.hours, 2) into v_before from public.fulfillment_week_days(p_rep, p_start) d where d.day = v_day;
    continue when v_before = v_after;
    insert into fulfillment_hour_fixes (rep_id, period_start, day, before_hours, after_hours, reason, changed_by)
    values (p_rep, p_start, v_day, v_before, v_after, btrim(p_reason), auth.uid());
    n := n + 1;
  end loop;

  select * into f from public.fulfillment_week_figures(p_rep, p_start);
  if n > 0 then
    insert into fulfillment_payouts as fo (rep_id, period_start, period_end, hours, rate_cents, amount_cents)
    values (p_rep, f.period_start, f.period_end, f.hours, f.rate_cents, f.amount_cents)
    on conflict (rep_id, period_start) do update
      set hours = excluded.hours, rate_cents = excluded.rate_cents, amount_cents = excluded.amount_cents
      where fo.status in ('upcoming', 'failed', 'held');
  end if;

  period_start := p_start;
  hours        := f.hours;
  amount_cents := f.amount_cents;
  changed      := n;
  return next;
end;
$$;

revoke all on function public.fulfillment_week_days(uuid, date, timestamptz) from public, anon;
revoke all on function public.fulfillment_fix_hours(uuid, date, jsonb, text) from public, anon;
grant execute on function public.fulfillment_week_days(uuid, date, timestamptz) to authenticated, service_role;
grant execute on function public.fulfillment_fix_hours(uuid, date, jsonb, text) to authenticated;
