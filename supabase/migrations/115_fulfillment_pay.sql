-- Migration 115: Fulfillment "Getting Paid" (Prompt 681)
--
-- Tracking only, not payroll. Fulfillment reps are paid flat hourly, by hand;
-- this gives Brayden (and each rep) the numbers to pay from: the rep's
-- scheduled shift, their hourly rate, and the hours they actually clocked.
-- Nothing here moves money and there is no processor behind it.
--
-- Two tables, kept off `profiles` on purpose: profiles has the column-scoped
-- directory grant (112) and the privileged-column guard (109/113), and pay is
-- private to the rep + admin, so a separate table with its own RLS is simpler
-- than threading more columns through both.
--
--   fulfillment_pay           one row per rep: hourly rate + scheduled shift.
--                             Admin writes; the rep reads their own.
--   fulfillment_time_entries  clock-in / clock-out pairs. The rep clocks
--                             themselves in and out; the server stamps the
--                             times (now()) so a rep can't backdate or pad.
--                             Admin can add, fix or delete any entry.
--
-- Pay period is weekly, Monday to Sunday, computed client-side. Nothing in the
-- schema depends on it, so changing to biweekly later is a frontend change.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.fulfillment_pay (
  profile_id         uuid primary key references public.profiles(id) on delete cascade,
  hourly_rate_cents  integer check (hourly_rate_cents is null or hourly_rate_cents between 0 and 100000),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday
  shift_days         smallint[] not null default '{1,2,3,4,5}'
                       check (shift_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  shift_start        time,
  shift_end          time,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null,
  check ((shift_start is null) = (shift_end is null)),
  check (shift_start is null or shift_end > shift_start)
);

alter table public.fulfillment_pay enable row level security;

create policy fulfillment_pay_select on public.fulfillment_pay
  for select using (profile_id = auth.uid() or public.is_admin());
create policy fulfillment_pay_admin_insert on public.fulfillment_pay
  for insert with check (public.is_admin());
create policy fulfillment_pay_admin_update on public.fulfillment_pay
  for update using (public.is_admin()) with check (public.is_admin());
create policy fulfillment_pay_admin_delete on public.fulfillment_pay
  for delete using (public.is_admin());

create or replace function public.fulfillment_pay_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists fulfillment_pay_stamp on public.fulfillment_pay;
create trigger fulfillment_pay_stamp before insert or update on public.fulfillment_pay
  for each row execute function public.fulfillment_pay_stamp();

-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.fulfillment_time_entries (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  clock_in    timestamptz not null default now(),
  clock_out   timestamptz,
  created_at  timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);

create index if not exists fulfillment_time_entries_profile_idx
  on public.fulfillment_time_entries (profile_id, clock_in desc);
-- One open shift per rep at a time.
create unique index if not exists fulfillment_time_entries_one_open
  on public.fulfillment_time_entries (profile_id) where clock_out is null;

alter table public.fulfillment_time_entries enable row level security;

create policy fte_select on public.fulfillment_time_entries
  for select using (profile_id = auth.uid() or public.is_admin());
create policy fte_insert on public.fulfillment_time_entries
  for insert with check (
    public.is_admin() or (profile_id = auth.uid() and public.is_fulfillment())
  );
-- A rep may only close their own open entry; the trigger pins what changes.
create policy fte_update on public.fulfillment_time_entries
  for update using (
    public.is_admin() or (profile_id = auth.uid() and clock_out is null and public.is_fulfillment())
  ) with check (
    public.is_admin() or (profile_id = auth.uid() and public.is_fulfillment())
  );
create policy fte_admin_delete on public.fulfillment_time_entries
  for delete using (public.is_admin());

-- Non-admins never choose a timestamp: clocking in is "now", clocking out is
-- "now", and nothing else on the row can change.
create or replace function public.fulfillment_time_entries_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.profile_id := auth.uid();
      new.clock_in   := now();
      new.clock_out  := null;
      new.created_at := now();
    else
      if new.profile_id is distinct from old.profile_id
      or new.clock_in   is distinct from old.clock_in
      or new.created_at is distinct from old.created_at
      or old.clock_out  is not null
      or new.clock_out  is null then
        raise exception 'You can only clock out of your open shift'
          using errcode = '42501';
      end if;
      new.clock_out := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_time_entries_guard on public.fulfillment_time_entries;
create trigger fulfillment_time_entries_guard before insert or update on public.fulfillment_time_entries
  for each row execute function public.fulfillment_time_entries_guard();
