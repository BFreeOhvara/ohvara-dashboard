-- Prompt 753 — "My pay": fulfillment reps get paid through Stripe Connect.
--
-- Reps receive money into a Stripe Express connected account (bank or debit
-- card), set up and managed with Stripe's embedded components inside the
-- portal. Ohvara never sees bank or tax numbers; this schema holds only the
-- status Stripe reports and the last 4 digits of where the money goes.
--
--   fulfillment_payout_accounts  one row per rep: what Stripe says about their
--                                connected account (payouts enabled, what's
--                                due, bank name + last 4). Written only by the
--                                server (service role) from account.updated and
--                                the fulfillment-connect-session overview.
--   fulfillment_payouts          one row per rep per pay week (Mon–Sun in the
--                                rep's own time zone). Hours and amount always
--                                come from fulfillment_week_figures below, i.e.
--                                the schedule in fulfillment_pay (P681/P685),
--                                never from a client.
--   recovery_config.payouts_live off switch (default off). While off, reps can
--                                connect and fill in everything, but nothing
--                                pays (fulfillment-pay-week refuses).
--   profiles.payout_email_sent / payout_email_problem   the rep's two email
--                                switches, both default on.
--
-- Status of a pay week: upcoming (not paid yet) → approved (an admin hit
-- Approve & pay; the Stripe transfer is being made) → paid, or failed (the
-- transfer was refused or later reversed) / held (the rep's payout account
-- wasn't ready). failed and held can be paid again.

-- ── switches ────────────────────────────────────────────────────────────────
alter table public.recovery_config
  add column if not exists payouts_live boolean not null default false;
grant update (payouts_live) on public.recovery_config to authenticated;

alter table public.profiles
  add column if not exists payout_email_sent boolean not null default true,
  add column if not exists payout_email_problem boolean not null default true;

-- ── connected account status ────────────────────────────────────────────────
create table if not exists public.fulfillment_payout_accounts (
  rep_id             uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id  text not null,
  details_submitted  boolean not null default false,
  payouts_enabled    boolean not null default false,
  transfers_active   boolean not null default false,
  requirements_due   text[] not null default '{}',
  disabled_reason    text,
  external_kind      text check (external_kind in ('bank', 'card')),
  bank_name          text,
  last4              text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  updated_at         timestamptz not null default now()
);

alter table public.fulfillment_payout_accounts enable row level security;
drop policy if exists fpa_select on public.fulfillment_payout_accounts;
create policy fpa_select on public.fulfillment_payout_accounts
  for select using (rep_id = auth.uid() or public.is_admin());
revoke all on public.fulfillment_payout_accounts from anon, authenticated;
grant select on public.fulfillment_payout_accounts to authenticated;

-- ── pay weeks ───────────────────────────────────────────────────────────────
create table if not exists public.fulfillment_payouts (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              uuid not null references public.profiles(id) on delete cascade,
  period_start        date not null,          -- Monday
  period_end          date not null,          -- Sunday (inclusive)
  hours               numeric(7,2) not null default 0,
  rate_cents          integer not null default 0,
  amount_cents        integer not null default 0 check (amount_cents >= 0),
  status              text not null default 'upcoming'
                        check (status in ('upcoming', 'approved', 'paid', 'failed', 'held')),
  stripe_transfer_id  text unique,
  paid_to             text,                   -- "Chase •••• 4821" at the time it was paid
  paid_at             timestamptz,
  failure_reason      text,
  approved_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (rep_id, period_start),
  check (period_end = period_start + 6),
  check (extract(isodow from period_start) = 1),
  check (status <> 'paid' or (stripe_transfer_id is not null and paid_at is not null))
);
create index if not exists fulfillment_payouts_rep_idx on public.fulfillment_payouts (rep_id, period_start desc);

alter table public.fulfillment_payouts enable row level security;
drop policy if exists fp_select on public.fulfillment_payouts;
create policy fp_select on public.fulfillment_payouts
  for select using (rep_id = auth.uid() or public.is_admin());
drop policy if exists fp_admin_insert on public.fulfillment_payouts;
create policy fp_admin_insert on public.fulfillment_payouts
  for insert with check (public.is_admin());
drop policy if exists fp_admin_update on public.fulfillment_payouts;
create policy fp_admin_update on public.fulfillment_payouts
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists fp_admin_delete on public.fulfillment_payouts;
create policy fp_admin_delete on public.fulfillment_payouts
  for delete using (public.is_admin());
revoke all on public.fulfillment_payouts from anon;

create or replace function public.fulfillment_payouts_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fulfillment_payouts_stamp on public.fulfillment_payouts;
create trigger fulfillment_payouts_stamp before update on public.fulfillment_payouts
  for each row execute function public.fulfillment_payouts_stamp();

-- ── the server's pay math ───────────────────────────────────────────────────
-- Same rule as src/lib/payPeriod.js (shiftSegments): a rep works their
-- scheduled shift on their scheduled days, nothing to clock; hours accrue as
-- each shift elapses. Days and times are read in the rep's own time zone.
-- Callable by the rep for themselves, an admin, or the service role.
create or replace function public.fulfillment_week_figures(p_rep uuid, p_start date, p_now timestamptz default now())
returns table (period_start date, period_end date, hours numeric, rate_cents integer, amount_cents integer, ended boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_pay   public.fulfillment_pay;
  v_hours numeric := 0;
  v_day   date;
  v_from  timestamptz;
  v_to    timestamptz;
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

  if v_pay.shift_start is not null then
    for i in 0..6 loop
      v_day := p_start + i;
      continue when not (extract(isodow from v_day)::smallint = any (v_pay.shift_days));
      v_from := (v_day + v_pay.shift_start) at time zone v_tz;
      v_to   := (v_day + v_pay.shift_end)   at time zone v_tz;
      v_hours := v_hours + greatest(0, extract(epoch from least(v_to, p_now) - v_from)) / 3600;
    end loop;
  end if;

  period_start := p_start;
  period_end   := p_start + 6;
  hours        := round(v_hours, 2);
  rate_cents   := coalesce(v_pay.hourly_rate_cents, 0);
  amount_cents := round(v_hours * coalesce(v_pay.hourly_rate_cents, 0))::integer;
  ended        := p_now >= ((p_start + 7)::timestamp at time zone v_tz);
  return next;
end;
$$;

-- The Monday that starts the rep's current week, in their zone.
create or replace function public.fulfillment_week_start(p_rep uuid, p_now timestamptz default now())
returns date language sql stable security definer set search_path = public as $$
  select date_trunc('week', (p_now at time zone coalesce(timezone, 'America/Chicago')))::date
  from profiles where id = p_rep;
$$;

-- Creates / refreshes the rows for this week and last week from the schedule.
-- p_rep null: an admin syncs every Fulfillment rep; anyone else syncs only
-- themselves. Rows already approved or paid are never touched; a rep with no
-- rate or shift gets no row.
create or replace function public.fulfillment_sync_payouts(p_rep uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r      record;
  wk     date;
  f      record;
  n      integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_rep is not null and p_rep <> auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  for r in
    select p.id from profiles p join fulfillment_pay fp on fp.profile_id = p.id
    where p.role = 'fulfillment'
      and fp.hourly_rate_cents is not null and fp.shift_start is not null
      and (p.id = coalesce(p_rep, case when public.is_admin() then p.id else auth.uid() end))
  loop
    wk := public.fulfillment_week_start(r.id);
    foreach wk in array array[wk - 7, wk] loop
      select * into f from public.fulfillment_week_figures(r.id, wk);
      insert into fulfillment_payouts as fo (rep_id, period_start, period_end, hours, rate_cents, amount_cents)
      values (r.id, f.period_start, f.period_end, f.hours, f.rate_cents, f.amount_cents)
      on conflict (rep_id, period_start) do update
        set hours = excluded.hours, rate_cents = excluded.rate_cents, amount_cents = excluded.amount_cents
        where fo.status in ('upcoming', 'failed', 'held')
          and (fo.hours, fo.rate_cents, fo.amount_cents) is distinct from (excluded.hours, excluded.rate_cents, excluded.amount_cents);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;

revoke all on function public.fulfillment_week_figures(uuid, date, timestamptz) from public, anon;
revoke all on function public.fulfillment_week_start(uuid, timestamptz) from public, anon;
revoke all on function public.fulfillment_sync_payouts(uuid) from public, anon;
grant execute on function public.fulfillment_week_figures(uuid, date, timestamptz) to authenticated, service_role;
grant execute on function public.fulfillment_week_start(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.fulfillment_sync_payouts(uuid) to authenticated;
