-- 197 — Agent settings: each agent's time zone, working hours, live-transfer
-- phone, on-duty default, and push and email choices per notification type.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step.
-- Additive: one table, two profile columns, four notification types, four new
-- functions, and account_delete re-stated whole from 156 with its new cleanup.
-- No screen reads this yet. Nothing is sent, and nothing that sends reads it yet.
--
-- CONTRACT (bookings and first-run Settings build on these names):
--
--   table    public.agent_working_hours (agent_id, weekday 1-7 ISO with 1 = Monday,
--            start_time, end_time; primary key agent_id + weekday). One range per
--            day. A missing row is a closed day. An overnight range can't be stored.
--   columns  profiles.live_transfer_phone (E.164 or null), profiles.on_duty_default
--   key      notification_prefs.push_types.<type>. notification_prefs.push is the
--            boolean master switch and push_on() casts it, so it stays a boolean.
--
--   my_agent_settings() returns jsonb:
--     { timezone, working_hours: [{ weekday, start, end }], live_transfer_phone,
--       on_duty_default, notifications: [{ type, label, fires, email_on, push_on }] }
--     Times are 'HH:MM', end may be '24:00'. All six types, always. Signed-in
--     active agents only. A locked self-signup can read its own settings.
--
--   save_my_agent_settings(p jsonb) returns the same shape. Acts on auth.uid().
--     Only keys present change. Keys: timezone, working_hours (replaces the whole
--     week; [] closes every day), live_transfer_phone (null clears it),
--     on_duty_default (the default only, never agent_duty), notifications
--     ([{ type, email?, push? }], merged per type). Everything is checked first,
--     so one bad field saves nothing. Refused for anyone but an active, unlocked
--     agent: account_delete leaves the signed-in token working until it expires
--     and block_inactive_writer is not on profiles, so without this a leftover
--     session could put the phone and hours back on a closed account.
--
--   agent_in_working_hours(p_agent uuid, p_at timestamptz) returns boolean.
--     Service role and definer functions only: from the browser, Agent A could
--     probe Agent B's hours. pg_timezone_names is a slowish view, so a booking
--     function should check many slots in one query, not call this per slot.
--
-- WHAT WAS REUSED AND WHAT WAS ADDED:
--
--   | Setting             | Decision |
--   |---------------------|----------|
--   | time zone           | reused profiles.timezone (042). |
--   | working hours       | added agent_working_hours, because 064's columns hold one range; old columns left, adminDesk.js still reads them. |
--   | live-transfer phone | added profiles.live_transfer_phone after a search found no existing column; help-transfer dials profiles.phone, the general contact number, and still does until the live-transfer goal moves it. |
--   | on-duty default     | added profiles.on_duty_default; agent_duty holds on-duty right now and is untouched. |
--   | email choices       | reused notification_prefs.email. |
--   | push choices        | added key notification_prefs.push_types, because .push is the master switch; stored only, not read by notify_queue_push yet. |
--   | notification types  | two reused, four added with fires=false. |
--
-- KNOWN GAPS, not fixed here:
--   * After account close a leftover session can still directly UPDATE
--     live_transfer_phone, on_duty_default or notification_prefs on its own row,
--     the same existing gap as profiles.phone.
--   * A non-boolean email.<type> written directly still makes notify_email_on raise
--     for that person when notify() queues that type (existing reader, unchanged).
--   * 064's comment says empty prefs mean enabled, but the live reader falls back
--     to email_default, so empty is off for most types. Kept as it is.

-- ── 1. Notification types ───────────────────────────────────────────────────
-- email_via must be 'notify': with null, notify_email_on always returns false and
-- set_notification_email refuses the type. fires=false keeps these out of
-- my_notification_settings, so today's Settings list does not change.
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort) values
  ('new_lead',          '{agent}', 'New lead',              false, 'notify', true, true, false, false, 60),
  ('live_call_ringing', '{agent}', 'Live call ringing',     false, 'notify', true, true, false, false, 61),
  ('appointment_1h',    '{agent}', 'Appointment in 1 hour', false, 'notify', true, true, false, false, 62),
  ('request_done',      '{agent}', 'Request done',          false, 'notify', true, true, false, false, 63)
on conflict (type) do nothing;

-- ── 2. Working hours ────────────────────────────────────────────────────────
create table if not exists public.agent_working_hours (
  agent_id   uuid not null references public.profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time   time not null,
  primary key (agent_id, weekday),
  check (start_time < end_time)
);

alter table public.agent_working_hours enable row level security;

drop policy if exists agent_working_hours_select_own on public.agent_working_hours;
drop policy if exists agent_working_hours_select_admin on public.agent_working_hours;

create policy agent_working_hours_select_own on public.agent_working_hours
  for select to authenticated using (auth.uid() = agent_id);
create policy agent_working_hours_select_admin on public.agent_working_hours
  for select to authenticated using (public.is_admin());

-- Every change goes through save_my_agent_settings. VAs get no direct read; a
-- later booking function asks through agent_in_working_hours.
revoke all on public.agent_working_hours from anon, authenticated;
grant select on public.agent_working_hours to authenticated;

-- a0_ runs first (triggers fire in name order), the same name 151 uses.
-- account_delete runs with no auth.uid(), so this lets it through.
drop trigger if exists a0_block_inactive_writer on public.agent_working_hours;
create trigger a0_block_inactive_writer
  before insert or update or delete on public.agent_working_hours
  for each row execute function public.block_inactive_writer();

-- ── 3. Profile columns ──────────────────────────────────────────────────────
-- The CHECK matters: authenticated holds table-wide UPDATE on profiles, so an
-- agent can write their own row directly. Neither column joins the 112 select
-- grant, so only get_my_profile, admin_list_profiles and these functions read them.
alter table public.profiles
  add column if not exists live_transfer_phone text
    check (live_transfer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  add column if not exists on_duty_default boolean not null default false;

comment on column public.profiles.live_transfer_phone is
  'The number live transfers should ring (E.164). help-transfer still dials profiles.phone until the live-transfer goal moves it.';
comment on column public.profiles.on_duty_default is
  'Whether the agent starts on duty. agent_duty holds on-duty right now.';

-- ── 4. The six types (private) ──────────────────────────────────────────────
create or replace function public.agent_settings_types()
returns text[] language sql immutable security definer set search_path = public as $$
  select array['new_lead', 'live_call_ringing', 'appointment_1h', 'needs_attention', 'request_done', 'payment_failed']
$$;
revoke execute on function public.agent_settings_types() from public, anon, authenticated;

-- ── 5. Read ─────────────────────────────────────────────────────────────────
-- Agents can update notification_prefs directly, so nothing here trusts its
-- shape. No key means the registry's default. notify_email_on casts with
-- ::boolean, so a present non-boolean skips it. No fallback to profiles.phone.
create or replace function public.my_agent_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me profiles;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into me from profiles where id = auth.uid() and role = 'agent' and is_active and deleted_at is null;
  if not found then raise exception 'Only an active agent has these settings' using errcode = '42501'; end if;

  return jsonb_build_object(
    'timezone', me.timezone,
    'working_hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday,
                                          'start', to_char(h.start_time, 'HH24:MI'),
                                          'end', to_char(h.end_time, 'HH24:MI')) order by h.weekday)
        from agent_working_hours h where h.agent_id = me.id), '[]'::jsonb),
    'live_transfer_phone', me.live_transfer_phone,
    'on_duty_default', me.on_duty_default,
    'notifications', (
      select jsonb_agg(jsonb_build_object(
               'type', t.type,
               'label', t.label,
               'fires', t.fires,
               'email_on', case when me.notification_prefs -> 'email' -> t.type is null
                                  or jsonb_typeof(me.notification_prefs -> 'email' -> t.type) = 'boolean'
                                then coalesce(public.notify_email_on(me.id, t.type), false)
                                else t.email_default end,
               'push_on', case when jsonb_typeof(me.notification_prefs -> 'push_types' -> t.type) = 'boolean'
                               then (me.notification_prefs -> 'push_types' -> t.type)::boolean
                               else t.push end) order by l.ord)
        from unnest(public.agent_settings_types()) with ordinality as l(type, ord)
        join notification_types t on t.type = l.type));
end;
$$;
revoke execute on function public.my_agent_settings() from public, anon, service_role;
grant execute on function public.my_agent_settings() to authenticated;

-- ── 6. Save ─────────────────────────────────────────────────────────────────
create or replace function public.save_my_agent_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       profiles;
  el       jsonb;
  k        text;
  v_day    smallint;
  v_days   smallint[] := '{}';
  v_prefs  jsonb;
  v_email  jsonb;
  v_push   jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into me from profiles where id = auth.uid() for update;
  if not found or me.role::text <> 'agent' or not coalesce(me.is_active, false) or me.deleted_at is not null then
    raise exception 'Only an active agent can change these settings' using errcode = '42501';
  end if;
  if public.is_locked_self_signup() then
    raise exception 'Choose a plan to unlock your portal.' using errcode = '42501';
  end if;

  -- Check everything first, so one bad field means nothing is saved.
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Settings must be a JSON object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('timezone', 'working_hours', 'live_transfer_phone', 'on_duty_default', 'notifications') then
      raise exception 'Unknown setting: %', k using errcode = '22023';
    end if;
  end loop;

  -- Trying AT TIME ZONE is not a real check: it accepts POSIX-style strings like 'Foo3'.
  if p ? 'timezone' and (jsonb_typeof(p -> 'timezone') <> 'string'
     or not exists (select 1 from pg_timezone_names where name = p ->> 'timezone')) then
    raise exception 'That isn''t a time zone' using errcode = '22023';
  end if;

  if p ? 'working_hours' then
    if jsonb_typeof(p -> 'working_hours') <> 'array' then
      raise exception 'Working hours must be a list of days' using errcode = '22023';
    end if;
    for el in select jsonb_array_elements(p -> 'working_hours') loop
      if jsonb_typeof(el -> 'weekday') is distinct from 'number' or el ->> 'weekday' !~ '^[1-7]$' then
        raise exception 'Each day needs a weekday from 1 to 7' using errcode = '22023';
      end if;
      v_day := (el ->> 'weekday')::smallint;
      if v_day = any(v_days) then
        raise exception 'That day is listed twice' using errcode = '22023';
      end if;
      v_days := v_days || v_day;
      if jsonb_typeof(el -> 'start') is distinct from 'string'
         or jsonb_typeof(el -> 'end') is distinct from 'string'
         or el ->> 'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or el ->> 'end' !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
        raise exception 'Times must look like 09:00' using errcode = '22023';
      end if;
      if (el ->> 'start')::time >= (el ->> 'end')::time then
        raise exception 'Hours must end after they start. Overnight hours aren''t allowed.' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p ? 'live_transfer_phone' and jsonb_typeof(p -> 'live_transfer_phone') <> 'null'
     and (jsonb_typeof(p -> 'live_transfer_phone') <> 'string'
          or p ->> 'live_transfer_phone' !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Phone must look like +15125551234' using errcode = '22023';
  end if;

  if p ? 'on_duty_default' and jsonb_typeof(p -> 'on_duty_default') <> 'boolean' then
    raise exception 'On-duty default must be true or false' using errcode = '22023';
  end if;

  if p ? 'notifications' then
    if jsonb_typeof(p -> 'notifications') <> 'array' then
      raise exception 'Notifications must be a list' using errcode = '22023';
    end if;
    for el in select jsonb_array_elements(p -> 'notifications') loop
      if jsonb_typeof(el -> 'type') is distinct from 'string'
         or not (el ->> 'type' = any(public.agent_settings_types())) then
        raise exception 'Not a notification you can set here' using errcode = '22023';
      end if;
      if (el ? 'email' and jsonb_typeof(el -> 'email') <> 'boolean')
         or (el ? 'push' and jsonb_typeof(el -> 'push') <> 'boolean') then
        raise exception 'Email and push must be true or false' using errcode = '22023';
      end if;
    end loop;

    -- jsonb || on a scalar makes an array instead of merging, so anything that
    -- isn't an object counts as {} and this save repairs it.
    v_prefs := case when jsonb_typeof(me.notification_prefs) = 'object' then me.notification_prefs else '{}'::jsonb end;
    v_email := case when jsonb_typeof(v_prefs -> 'email') = 'object' then v_prefs -> 'email' else '{}'::jsonb end;
    v_push  := case when jsonb_typeof(v_prefs -> 'push_types') = 'object' then v_prefs -> 'push_types' else '{}'::jsonb end;
    for el in select jsonb_array_elements(p -> 'notifications') loop
      if el ? 'email' then v_email := v_email || jsonb_build_object(el ->> 'type', el -> 'email'); end if;
      if el ? 'push' then v_push := v_push || jsonb_build_object(el ->> 'type', el -> 'push'); end if;
    end loop;
    v_prefs := v_prefs || jsonb_build_object('email', v_email, 'push_types', v_push);
  end if;

  -- The stamp follows Settings.jsx: it moves when the zone changes, not on a re-save.
  update profiles set
    timezone = case when p ? 'timezone' then p ->> 'timezone' else timezone end,
    timezone_confirmed_at = case when p ? 'timezone' and p ->> 'timezone' <> timezone then now() else timezone_confirmed_at end,
    live_transfer_phone = case when p ? 'live_transfer_phone' then p ->> 'live_transfer_phone' else live_transfer_phone end,
    on_duty_default = case when p ? 'on_duty_default' then (p ->> 'on_duty_default')::boolean else on_duty_default end,
    notification_prefs = coalesce(v_prefs, notification_prefs)
  where id = me.id;

  if p ? 'working_hours' then
    delete from agent_working_hours where agent_id = me.id;
    insert into agent_working_hours (agent_id, weekday, start_time, end_time)
    select me.id, (d ->> 'weekday')::smallint, (d ->> 'start')::time, (d ->> 'end')::time
      from jsonb_array_elements(p -> 'working_hours') d;
  end if;

  return public.my_agent_settings();
end;
$$;
revoke execute on function public.save_my_agent_settings(jsonb) from public, anon, service_role;
grant execute on function public.save_my_agent_settings(jsonb) to authenticated;

-- ── 7. Is this agent working at this moment? ────────────────────────────────
-- profiles.timezone can be changed directly, so it is never trusted, and there is
-- no Chicago default the way notify_tz has one: an unknown zone is simply false.
-- The weekday comes from the LOCAL date (Sunday 11 PM Chicago is Monday in UTC).
create or replace function public.agent_in_working_hours(p_agent uuid, p_at timestamptz)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_tz    text;
  v_local timestamp;
begin
  if p_agent is null or p_at is null then return false; end if;
  select timezone into v_tz from profiles where id = p_agent;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then return false; end if;
  v_local := p_at at time zone v_tz;
  return exists (
    select 1 from agent_working_hours h
     where h.agent_id = p_agent
       and h.weekday = extract(isodow from v_local)
       and h.start_time <= v_local::time
       and v_local::time < h.end_time);
end;
$$;
revoke execute on function public.agent_in_working_hours(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.agent_in_working_hours(uuid, timestamptz) to service_role;

-- ── 8. Delete my account ────────────────────────────────────────────────────
-- Same as 156, plus the working hours, the phone and the default. Cascades don't
-- fire because the row is kept. timezone stays as it is today.
create or replace function public.account_delete(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      profiles;
  v_role  text;
  v_short text := left(p_uid::text, 8);
  a       record;
  n       jsonb := '{}'::jsonb;
  c       int;
begin
  select * into me from profiles where id = p_uid for update;
  if not found then raise exception 'No such account' using errcode = 'P0002'; end if;
  if me.deleted_at is not null then return jsonb_build_object('already', true); end if;
  if me.role::text = 'admin' then
    raise exception 'Admin accounts can''t be deleted this way' using errcode = '42501';
  end if;
  v_role := me.role::text;

  -- Their phones, alerts and emails.
  delete from push_devices where profile_id = p_uid;
  delete from notification_pushes where profile_id = p_uid;
  delete from notification_emails where profile_id = p_uid;
  delete from notifications where profile_id = p_uid;

  -- What they wrote and their own records.
  delete from direct_messages where sender_id = p_uid or (v_role = 'agent' and agent_id = p_uid);
  get diagnostics c = row_count; n := n || jsonb_build_object('direct_messages', c);
  delete from direct_message_reads where profile_id = p_uid or agent_id = p_uid;
  delete from policy_messages where sender_id = p_uid;
  get diagnostics c = row_count; n := n || jsonb_build_object('policy_messages', c);
  delete from policy_message_reads where profile_id = p_uid;
  delete from team_messages where sender_id = p_uid;
  delete from bug_reports where reporter_id = p_uid;
  delete from agent_licenses where profile_id = p_uid;
  delete from agent_carrier_appointments where profile_id = p_uid;
  delete from agent_monthly_goals where profile_id = p_uid;
  delete from rep_credentials where profile_id = p_uid;
  delete from rep_invites where created_by = p_uid and used_by is null;
  delete from agent_working_hours where agent_id = p_uid;

  -- The profile: no name, contact details, photo or settings left. The row
  -- stays (anonymous) because pay records, call records and recordings point
  -- at it. is_active off = signed out and blocked everywhere (P769 rules).
  update profiles set
    full_name = 'Deleted user',
    email = 'deleted-' || p_uid::text || '@deleted.invalid',
    phone = null, username = null, avatar_url = null, niche = null,
    npn = null, eo_carrier = null, eo_policy_expires_on = null,
    caller_id_number = null, caller_id_verified_at = null, caller_id_twilio_sid = null,
    caller_id_pending_number = null, caller_id_pending_at = null, caller_id_enabled = false,
    no_answer_sms_opt_in = false, no_answer_sms_opted_in_at = null,
    notification_prefs = '{}'::jsonb, payout_email_sent = false, payout_email_problem = false,
    upline_id = null, working_hours_start = null, working_hours_end = null,
    live_transfer_phone = null, on_duty_default = false,
    is_active = false, deleted_at = now()
  where id = p_uid;

  -- Anyone who had them as upline.
  update profiles set upline_id = null where upline_id = p_uid;

  -- Tell the admins (bell + email). No name: it's gone.
  for a in select id from profiles where role = 'admin' and is_active and deleted_at is null loop
    perform public.notify(a.id, 'account_deleted', 'Someone deleted their account',
      initcap(case v_role when 'fulfillment' then 'Fulfillment' else v_role end) || ' account · id ' || v_short || '. Pay and call records were kept.',
      '/admin/users', false, 'deleted:' || p_uid::text, jsonb_build_object('profile_id', p_uid));
  end loop;

  return jsonb_build_object('deleted', true, 'role', v_role) || n;
end;
$$;
revoke all on function public.account_delete(uuid) from public, anon, authenticated;
grant execute on function public.account_delete(uuid) to service_role;
