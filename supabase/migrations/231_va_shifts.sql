-- Prompt 851 — VA shifts, the rota and day-off requests (backend only).
--
-- VAs (profiles.role = 'fulfillment') no longer switch themselves Active or
-- Away (P846). They work set hours, the carriers' hours (about 8 AM to 6 PM
-- Central), in a rotation: two or three VAs on shift each day, not always the
-- same people. The Ohvara team (admins) builds the rota; VAs ask for days off
-- ahead and an admin approves or declines.
--
-- Tables
--   va_shifts             one row per VA per day on the rota: date, start, end
--                         and the time zone the hours are in. Admins write;
--                         every VA can read the whole rota (the VA pages show
--                         who is on with them).
--   va_day_off_requests   one row per VA per day asked off: reason, status
--                         pending / approved / declined, who decided and when.
--                         A VA writes only their own (always 'pending'); only
--                         an admin decides. A VA sees their own; admins see all.
--
-- Functions (all check the caller themselves; anon gets none)
--   va_shifts_today(p_day)                 who is on shift that day (default today, Central)
--   va_shift_week(p_from, p_days, p_va)    the rota for a run of days (default this week)
--   va_request_day_off(p_day, p_reason)    a VA asks for a day off (tells the admins)
--   va_cancel_day_off(p_day)               a VA takes back a request for a day still ahead
--   va_decide_day_off(p_request, p_approve) an admin approves or declines (tells the VA)
--   va_on_shift_at(p_va, p_at)             is that VA on shift at that moment
--
-- Auto-assign (116, redefined in 156): fulfillment_pick_rep now prefers VAs on
-- shift at the call time, behind app_settings.va_shift_assign_live (default
-- OFF). With the flag off every rep ranks the same as before, so the pick is
-- byte-for-byte the 156 order. With it on: VAs on shift at the call time come
-- first; if nobody is on shift then, it falls back to the old pick (VAs on an
-- approved day off last) so a booking never sits unassigned where nobody sees
-- it — the same rule 116 already follows for double-booking.
-- fulfillment_rep_free / fulfillment_slot_free (no-answer recovery, missed-by-us)
-- are left as they are.
--
-- Nothing here texts, calls or emails anyone; the only side effect is in-app
-- notification rows.

-- ── the flag ────────────────────────────────────────────────────────────────

alter table public.app_settings
  add column if not exists va_shift_assign_live boolean not null default false;

comment on column public.app_settings.va_shift_assign_live is
  'P851: when true, auto-assign (fulfillment_pick_rep) gives cancellation calls to VAs on shift at the call time first. Default false.';

-- ── notification types (bell only: no email, no push) ───────────────────────

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort) values
  ('va_day_off_requested', '{admin}',       'A VA asked for a day off',     false, null, true, false, false, true, 70),
  ('va_day_off_decided',   '{fulfillment}', 'Your day off was approved or declined', false, null, true, false, false, true, 71)
on conflict (type) do nothing;

-- ── shifts ──────────────────────────────────────────────────────────────────

create table if not exists public.va_shifts (
  id          uuid primary key default gen_random_uuid(),
  va_id       uuid not null references public.profiles(id) on delete cascade,
  shift_date  date not null,
  starts      time not null default '08:00',
  ends        time not null default '18:00',
  tz          text not null default 'America/Chicago',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint va_shifts_one_a_day unique (va_id, shift_date),
  constraint va_shifts_ends_after_starts check (ends > starts)
);

create index if not exists va_shifts_date_idx on public.va_shifts (shift_date);

comment on table public.va_shifts is
  'P851: the VA rota. One row per VA per day on shift. starts/ends are wall-clock times in tz.';

-- The VA must be a Fulfillment login and the time zone a real one.
create or replace function public.va_shifts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.va_id and role = 'fulfillment') then
    raise exception 'Shifts are for VAs (Fulfillment logins) only' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.tz) then
    raise exception 'Unknown time zone %', new.tz using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists va_shifts_guard on public.va_shifts;
create trigger va_shifts_guard
  before insert or update on public.va_shifts
  for each row execute function public.va_shifts_guard();

alter table public.va_shifts enable row level security;

drop policy if exists "va_shifts_read" on public.va_shifts;
create policy "va_shifts_read" on public.va_shifts for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

drop policy if exists "va_shifts_admin_insert" on public.va_shifts;
create policy "va_shifts_admin_insert" on public.va_shifts for insert to authenticated
  with check (public.is_admin());

drop policy if exists "va_shifts_admin_update" on public.va_shifts;
create policy "va_shifts_admin_update" on public.va_shifts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "va_shifts_admin_delete" on public.va_shifts;
create policy "va_shifts_admin_delete" on public.va_shifts for delete to authenticated
  using (public.is_admin());

revoke all on public.va_shifts from anon;

-- ── day-off requests ────────────────────────────────────────────────────────

create table if not exists public.va_day_off_requests (
  id          uuid primary key default gen_random_uuid(),
  va_id       uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  off_date    date not null,
  reason      text check (reason is null or char_length(reason) <= 500),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint va_day_off_one_a_day unique (va_id, off_date)
);

create index if not exists va_day_off_date_idx on public.va_day_off_requests (off_date);

comment on table public.va_day_off_requests is
  'P851: a VA asks for a day off ahead; an admin approves or declines. Approved days take the VA off auto-assign that day.';

-- The company day ("today") is Central: the carriers' hours the rota follows.
create or replace function public.va_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone 'America/Chicago')::date
$$;

-- Server rules a client can't skip: the VA is a Fulfillment login, a VA can't
-- ask for a day already gone, and only an admin can set or change a decision.
create or replace function public.va_day_off_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.va_id and role = 'fulfillment') then
    raise exception 'Day-off requests are for VAs (Fulfillment logins) only' using errcode = '22023';
  end if;
  if public.is_admin() or auth.uid() is null then   -- admins, and the table owner (migrations, tests, service role)
    if new.status <> 'pending' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    elsif new.status = 'pending' then
      new.decided_by := null;
      new.decided_at := null;
    end if;
  else
    if new.off_date < public.va_today() then
      raise exception 'That day has already gone' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' then
      new.status := 'pending';
    else
      new.va_id := old.va_id;
      new.status := old.status;
    end if;
    new.decided_by := case when tg_op = 'INSERT' then null else old.decided_by end;
    new.decided_at := case when tg_op = 'INSERT' then null else old.decided_at end;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists va_day_off_guard on public.va_day_off_requests;
create trigger va_day_off_guard
  before insert or update on public.va_day_off_requests
  for each row execute function public.va_day_off_guard();

alter table public.va_day_off_requests enable row level security;

drop policy if exists "va_day_off_read" on public.va_day_off_requests;
create policy "va_day_off_read" on public.va_day_off_requests for select to authenticated
  using (public.is_admin() or va_id = auth.uid());

drop policy if exists "va_day_off_own_insert" on public.va_day_off_requests;
create policy "va_day_off_own_insert" on public.va_day_off_requests for insert to authenticated
  with check (
    public.is_admin()
    or (va_id = auth.uid() and public.is_fulfillment() and status = 'pending' and decided_by is null)
  );

-- Only admins change a request (decide it). A VA takes one back by deleting it.
drop policy if exists "va_day_off_admin_update" on public.va_day_off_requests;
create policy "va_day_off_admin_update" on public.va_day_off_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "va_day_off_delete" on public.va_day_off_requests;
create policy "va_day_off_delete" on public.va_day_off_requests for delete to authenticated
  using (public.is_admin() or (va_id = auth.uid() and off_date >= public.va_today()));

revoke all on public.va_day_off_requests from anon;

-- ── helpers ─────────────────────────────────────────────────────────────────

-- Is this VA on the rota at this moment, and not on an approved day off.
create or replace function public.va_on_shift_at(p_va uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_va is not null and p_at is not null and exists (
    select 1 from va_shifts s
     where s.va_id = p_va
       and s.shift_date between (p_at at time zone 'UTC')::date - 1 and (p_at at time zone 'UTC')::date + 1
       and p_at >= ((s.shift_date + s.starts) at time zone s.tz)
       and p_at <  ((s.shift_date + s.ends)   at time zone s.tz)
       and not exists (
         select 1 from va_day_off_requests d
          where d.va_id = s.va_id and d.off_date = s.shift_date and d.status = 'approved'))
$$;

-- Approved day off on the company day of this moment.
create or replace function public.va_off_at(p_va uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_va is not null and exists (
    select 1 from va_day_off_requests d
     where d.va_id = p_va and d.status = 'approved'
       and d.off_date = (coalesce(p_at, now()) at time zone 'America/Chicago')::date)
$$;

-- ── reading the rota ────────────────────────────────────────────────────────

-- Who is on shift that day: everyone on the rota who isn't on an approved day
-- off. Same side (live vs demo/test logins) as the caller.
create or replace function public.va_shifts_today(p_day date default null)
returns table (va_id uuid, full_name text, shift_date date, starts_at timestamptz, ends_at timestamptz,
               tz text, is_me boolean, on_now boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, public.va_today());
begin
  if not (public.is_admin() or public.is_fulfillment()) then
    raise exception 'Only the Ohvara team and VAs can see the rota' using errcode = '42501';
  end if;
  return query
    select s.va_id, p.full_name, s.shift_date,
           (s.shift_date + s.starts) at time zone s.tz,
           (s.shift_date + s.ends)   at time zone s.tz,
           s.tz, s.va_id = auth.uid(),
           now() >= ((s.shift_date + s.starts) at time zone s.tz) and now() < ((s.shift_date + s.ends) at time zone s.tz)
      from va_shifts s
      join profiles p on p.id = s.va_id
     where s.shift_date = v_day
       and p.role = 'fulfillment' and p.is_active
       and p.is_demo = public.my_is_demo()
       and not exists (
         select 1 from va_day_off_requests d
          where d.va_id = s.va_id and d.off_date = s.shift_date and d.status = 'approved')
     order by (s.va_id = auth.uid()) desc, s.starts, p.full_name;
end;
$$;

-- The rota for a run of days (default: this week, Monday to Sunday). One row
-- per VA per day on the rota, including VAs who are off that day, so a page can
-- show them crossed out. off_status: the caller's own request in any state,
-- another VA's only once approved (a VA doesn't see a teammate's pending ask);
-- admins see every state. p_va narrows it to one VA (a VA may only ask for
-- themselves).
create or replace function public.va_shift_week(p_from date default null, p_days integer default 7, p_va uuid default null)
returns table (shift_date date, va_id uuid, full_name text, starts_at timestamptz, ends_at timestamptz,
               tz text, is_me boolean, off_status text, off_reason text, request_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_from date := coalesce(p_from, date_trunc('week', public.va_today()::timestamp)::date);
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 42);
begin
  if not (v_admin or public.is_fulfillment()) then
    raise exception 'Only the Ohvara team and VAs can see the rota' using errcode = '42501';
  end if;
  if p_va is not null and p_va is distinct from auth.uid() and not v_admin then
    raise exception 'You can only see your own week' using errcode = '42501';
  end if;
  return query
    select s.shift_date, s.va_id, p.full_name,
           (s.shift_date + s.starts) at time zone s.tz,
           (s.shift_date + s.ends)   at time zone s.tz,
           s.tz, s.va_id = auth.uid(),
           case when v_admin or s.va_id = auth.uid() or d.status = 'approved' then d.status end,
           case when v_admin or s.va_id = auth.uid() then d.reason end,
           case when v_admin or s.va_id = auth.uid() then d.id end
      from va_shifts s
      join profiles p on p.id = s.va_id
      left join va_day_off_requests d on d.va_id = s.va_id and d.off_date = s.shift_date
     where s.shift_date >= v_from and s.shift_date < v_from + v_days
       and (p_va is null or s.va_id = p_va)
       and p.role = 'fulfillment' and p.is_active
       and p.is_demo = public.my_is_demo()
     order by s.shift_date, (s.va_id = auth.uid()) desc, s.starts, p.full_name;
end;
$$;

-- ── asking for and deciding days off ────────────────────────────────────────

-- A VA asks for a day off. Asking again for the same day updates the reason; a
-- declined day goes back to pending; an approved day stays approved. Tells the
-- admins (in-app notification only).
create or replace function public.va_request_day_off(p_day date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
  v_status text;
  v_name text;
begin
  if not exists (select 1 from profiles where id = v_me and role = 'fulfillment' and is_active) then
    raise exception 'Only VAs can ask for a day off' using errcode = '42501';
  end if;
  if p_day is null or p_day < public.va_today() then
    raise exception 'Pick a day that is still ahead' using errcode = '22023';
  end if;
  if p_day > public.va_today() + 120 then
    raise exception 'Ask no more than four months ahead' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023';
  end if;

  select id, status into v_id, v_status from va_day_off_requests
   where va_id = v_me and off_date = p_day for update;

  if v_id is null then
    insert into va_day_off_requests (va_id, off_date, reason) values (v_me, p_day, v_reason)
    returning id into v_id;
  elsif v_status = 'approved' then
    return v_id;
  elsif v_status = 'pending' then
    update va_day_off_requests set reason = v_reason where id = v_id;
  else
    -- declined: ask again as a fresh pending request (the guard keeps a VA's
    -- update from changing status, so it's replaced rather than updated)
    delete from va_day_off_requests where id = v_id;
    insert into va_day_off_requests (va_id, off_date, reason) values (v_me, p_day, v_reason)
    returning id into v_id;
  end if;

  select full_name into v_name from profiles where id = v_me;
  perform public.notify(a.id, 'va_day_off_requested',
            coalesce(nullif(btrim(v_name), ''), 'A VA') || ' asked for a day off',
            to_char(p_day, 'Dy, Mon FMDD') || coalesce(' · ' || v_reason, ''),
            '/admin/fulfillment', true, 'dayoff-ask:' || v_id,
            jsonb_build_object('request_id', v_id, 'va_id', v_me, 'day', p_day))
    from profiles a
   where a.role = 'admin' and a.is_active and a.is_demo = public.my_is_demo();
  return v_id;
end;
$$;

-- A VA takes back their own request for a day still ahead (any status). Returns
-- true when there was one.
create or replace function public.va_cancel_day_off(p_day date)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_fulfillment() then
    raise exception 'Only VAs can take back a day off' using errcode = '42501';
  end if;
  if p_day is null or p_day < public.va_today() then
    raise exception 'That day has already gone' using errcode = '22023';
  end if;
  delete from va_day_off_requests where va_id = auth.uid() and off_date = p_day;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- An admin approves or declines. Tells the VA (in-app notification only).
create or replace function public.va_decide_day_off(p_request uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  r va_day_off_requests;
  v_status text := case when p_approve then 'approved' else 'declined' end;
begin
  if not public.is_admin() then
    raise exception 'Only the Ohvara team can decide a day off' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say approve or decline' using errcode = '22023';
  end if;
  select * into r from va_day_off_requests where id = p_request for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if r.status = v_status then
    return v_status;
  end if;
  update va_day_off_requests set status = v_status where id = p_request;
  perform public.notify(r.va_id, 'va_day_off_decided',
            case when p_approve then 'Day off approved' else 'Day off declined' end,
            to_char(r.off_date, 'Dy, Mon FMDD')
              || case when p_approve then '' else ' · you are still on the rota that day' end,
            '/fulfillment/schedule', false, 'dayoff:' || r.id || ':' || v_status,
            jsonb_build_object('request_id', r.id, 'day', r.off_date, 'status', v_status));
  return v_status;
end;
$$;

-- ── auto-assign: on-shift VAs first (behind the flag) ───────────────────────

-- Same as 156 with one ranking key in front: tier. Flag off → tier 0 for every
-- rep → the 156 order exactly. Flag on → 0 on shift at the call time (now when
-- the call has no time), 1 not on shift, 2 on an approved day off.
create or replace function public.fulfillment_pick_rep(p_at timestamp with time zone, p_policy uuid default null, p_exclude uuid default null, p_prefer uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  with side as (select public.policy_is_demo(p_policy) as demo),
  flag as (select coalesce((select va_shift_assign_live from app_settings where id = 1), false) as live),
  reps as (
    select id,
      case when not flag.live then 0
           when public.va_on_shift_at(id, coalesce(p_at, now())) then 0
           when public.va_off_at(id, p_at) then 2
           else 1 end as tier
    from profiles, side, flag
    where role = 'fulfillment' and is_active
      and is_demo = side.demo
      and id is distinct from p_exclude
  ),
  stats as (
    select r.id, r.tier,
      count(po.id) as load,
      count(po.id) filter (
        where p_at is not null and po.scheduled_call_at is not null
          and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800
      ) as conflicts,
      max(po.fulfillment_claimed_at) as last_assigned
    from reps r
    left join policies po
      on po.assigned_fulfillment_id = r.id
     and po.fulfillment_assigned
     and po.fulfillment_stage is distinct from 'Complete'
     and po.id is distinct from p_policy
    group by r.id, r.tier
  )
  select id from stats
  order by tier,
           (conflicts > 0),
           (p_prefer is not null and id = p_prefer) desc,
           load,
           last_assigned nulls first,
           id
  limit 1
$$;

-- ── grants ──────────────────────────────────────────────────────────────────

revoke all on function public.va_shifts_guard() from public, anon, authenticated;
revoke all on function public.va_day_off_guard() from public, anon, authenticated;
revoke all on function public.fulfillment_pick_rep(timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.va_on_shift_at(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.va_off_at(uuid, timestamptz) from public, anon, authenticated;

revoke all on function public.va_today() from public, anon;
revoke all on function public.va_shifts_today(date) from public, anon;
revoke all on function public.va_shift_week(date, integer, uuid) from public, anon;
revoke all on function public.va_request_day_off(date, text) from public, anon;
revoke all on function public.va_cancel_day_off(date) from public, anon;
revoke all on function public.va_decide_day_off(uuid, boolean) from public, anon;

grant execute on function public.va_today() to authenticated;
grant execute on function public.va_shifts_today(date) to authenticated;
grant execute on function public.va_shift_week(date, integer, uuid) to authenticated;
grant execute on function public.va_request_day_off(date, text) to authenticated;
grant execute on function public.va_cancel_day_off(date) to authenticated;
grant execute on function public.va_decide_day_off(uuid, boolean) to authenticated;
