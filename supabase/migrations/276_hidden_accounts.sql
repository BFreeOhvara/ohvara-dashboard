-- 276_hidden_accounts (Prompt 1013, Brayden Nov 15): test/demo accounts and non-paying sign-ups are invisible to
-- everyone else, enforced here (not in the app).
--
--   * Internal accounts = profiles.is_test (P929, migration 260): Test Agent (testagent11), Test Fulfill
--     (testfulfill11), the App Review agent and VA. Live has no other test or demo account (checked Nov 15).
--   * A listed person (profile_listed) is: not a test account, and, for an agent, paying or paid before (comped,
--     any billing status but 'none' (active, past_due, lapsed,
--     canceled, exempt), servicing or leads on, or the P933 setup
--     paid). An agent who signed up and never paid is not listed until the first payment; then they show normally.
--     (Paid-before agents stay listed so names on their old clients and messages don't disappear.)
--   * profiles (the staff directory, migration 112): others only read listed rows. Admins also read non-paying
--     agents (their one place is Agents > "Signed up, not paying"), never test accounts. Your own row: always.
--   * The functions that list people or conversations are wrapped (originals renamed …_p1013, no longer callable
--     from the app) and drop anyone not listed: Messages lines (my_standing_threads; unread badges come from it),
--     the VA's agent list, agents on duty, lead pauses, unreachable agents, the team feed and activity feed, the VA
--     rota, ad costs per agent, and the admin people list (test accounts out; non-paying agents stay for the filter,
--     marked by admin_agent_activity.listed).
--   * One exception, admin only: a non-paying sign-up who wrote to Ohvara Support keeps that line in the admin's
--     Messages, so a stuck sign-up is never ignored. No empty line, no picker entry. Test accounts never.
--   * Test accounts still sign in and see their own portal as before (they read sample info, P929).
-- A later migration that redefines one of these functions keeps the filter (or re-wraps it).
-- Tests: supabase/tests/p1013_hidden_accounts.sql (PGlite).

-- 1. Who is listed ----------------------------------------------------------------------------------------------
create or replace function public.profile_listed(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not coalesce(p.is_test, false)
       and p.deleted_at is null
       and (p.role::text <> 'agent'
            or coalesce(p.billing_exempt, false)
            or coalesce(p.billing_status, 'none') <> 'none'   -- active, past_due, lapsed, canceled, exempt
            or public.servicing_active(p.id)
            or public.leads_active(p.id)
            or exists (select 1 from public.agent_billing_plans b where b.agent_id = p.id and b.setup_paid_at is not null))
      from public.profiles p where p.id = p_id), false)
$$;
comment on function public.profile_listed(uuid) is
  'P1013: true when this person may appear to others (not a test account; an agent only once paying or paid before).';

-- Shown to the signed-in viewer: yourself, or anyone listed.
create or replace function public.profile_shown(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_id is not null and (p_id = auth.uid() or public.profile_listed(p_id))
$$;
revoke execute on function public.profile_listed(uuid), public.profile_shown(uuid) from public, anon;
grant execute on function public.profile_listed(uuid), public.profile_shown(uuid) to authenticated, service_role;

-- 2. The staff directory --------------------------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  auth.uid() is not null
  and (id = auth.uid()
       or (not (select public.is_locked_self_signup())
           and not coalesce(is_test, false)
           and (role::text <> 'agent' or (select public.is_admin()) or public.profile_listed(id))))
);

-- 3. Messages lines ---------------------------------------------------------------------------------------------
alter function public.my_standing_threads() rename to my_standing_threads_p1013;
create function public.my_standing_threads()
returns table(agent_id uuid, agent_name text, peer_id uuid, peer_key text, peer_name text, last_body text,
              last_sender_id uuid, last_at timestamptz, unread_count integer, agent_avatar_url text,
              agent_avatar_color text, peer_avatar_url text, peer_avatar_color text, agent_role text)
language sql stable security definer set search_path = public as $$
  select t.*
    from public.my_standing_threads_p1013() t
    cross join lateral (select case when t.agent_id = auth.uid() then t.peer_id else t.agent_id end as other) o
   where o.other is null
      or o.other = auth.uid()
      or public.profile_listed(o.other)
      or (t.peer_id is null and t.last_at is not null and public.is_admin() and not public.profile_is_test(o.other))
$$;

-- 4. People lists -------------------------------------------------------------------------------------------------
alter function public.va_agent_roster() rename to va_agent_roster_p1013;
create function public.va_agent_roster()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select t.* from public.va_agent_roster_p1013() t where public.profile_shown(t.id)
$$;

alter function public.on_duty_agents() rename to on_duty_agents_p1013;
create function public.on_duty_agents()
returns table(agent_id uuid, full_name text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select t.* from public.on_duty_agents_p1013() t where public.profile_shown(t.agent_id)
$$;

alter function public.admin_lead_pauses() rename to admin_lead_pauses_p1013;
create function public.admin_lead_pauses()
returns table(agent_id uuid, full_name text, paused_at timestamptz, resume_on date)
language sql stable security definer set search_path = public as $$
  select t.* from public.admin_lead_pauses_p1013() t where public.profile_shown(t.agent_id)
$$;

alter function public.admin_unreachable_agents() rename to admin_unreachable_agents_p1013;
create function public.admin_unreachable_agents()
returns table(agent_id uuid, name text, reason text, devices integer, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.* from public.admin_unreachable_agents_p1013() t where public.profile_shown(t.agent_id)
$$;

alter function public.team_activity(timestamptz) rename to team_activity_p1013;
create function public.team_activity(p_since timestamptz default (now() - interval '7 days'))
returns table(kind text, at timestamptz, agent_id uuid, agent_first_name text, avatar_url text, avatar_color text)
language sql stable security definer set search_path = public as $$
  select t.* from public.team_activity_p1013(p_since) t where t.agent_id is null or public.profile_shown(t.agent_id)
$$;

alter function public.agent_activity_feed(timestamptz, timestamptz, uuid, integer) rename to agent_activity_feed_p1013;
create function public.agent_activity_feed(p_from timestamptz, p_to timestamptz, p_agent uuid default null,
                                           p_limit integer default 1000)
returns table(id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language sql stable security definer set search_path = public as $$
  select t.* from public.agent_activity_feed_p1013(p_from, p_to, p_agent, p_limit) t
   where t.agent_id is null or public.profile_shown(t.agent_id)
$$;

alter function public.va_shift_week(date, integer, uuid) rename to va_shift_week_p1013;
create function public.va_shift_week(p_from date default null, p_days integer default 7, p_va uuid default null)
returns table(shift_date date, va_id uuid, full_name text, starts_at timestamptz, ends_at timestamptz, tz text,
              is_me boolean, off_status text, off_reason text, request_id uuid)
language sql stable security definer set search_path = public as $$
  select t.* from public.va_shift_week_p1013(p_from, p_days, p_va) t where public.profile_shown(t.va_id)
$$;

alter function public.va_shifts_today(date) rename to va_shifts_today_p1013;
create function public.va_shifts_today(p_day date default null)
returns table(va_id uuid, full_name text, shift_date date, starts_at timestamptz, ends_at timestamptz, tz text,
              is_me boolean, on_now boolean)
language sql stable security definer set search_path = public as $$
  select t.* from public.va_shifts_today_p1013(p_day) t where public.profile_shown(t.va_id)
$$;

alter function public.admin_ad_costs(date, date) rename to admin_ad_costs_p1013;
create function public.admin_ad_costs(p_from date, p_to date)
returns table(agent_id uuid, agent_name text, spend_cents bigint, impressions bigint, clicks bigint, leads integer,
              booked integer, sold integer)
language sql stable security definer set search_path = public as $$
  select t.* from public.admin_ad_costs_p1013(p_from, p_to) t where t.agent_id is null or public.profile_listed(t.agent_id)
$$;

-- Admin's people list: never a test account. Non-paying agents stay (Agents > "Signed up, not paying").
alter function public.admin_list_profiles() rename to admin_list_profiles_p1013;
create function public.admin_list_profiles()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.admin_list_profiles_p1013() p where not coalesce(p.is_test, false)
$$;

-- P999's paying/active answer, plus listed (false = a sign-up who never paid: only under "Signed up, not paying").
alter function public.admin_agent_activity() rename to admin_agent_activity_p1013;
create function public.admin_agent_activity()
returns table(agent_id uuid, paying boolean, active boolean, listed boolean)
language sql stable security definer set search_path = public as $$
  select t.agent_id, t.paying, t.active, public.profile_listed(t.agent_id)
    from public.admin_agent_activity_p1013() t
   where not public.profile_is_test(t.agent_id)
$$;

-- 5. Grants: the wrappers as before; the originals only through them -------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'my_standing_threads()', 'va_agent_roster()', 'on_duty_agents()', 'admin_lead_pauses()',
    'admin_unreachable_agents()', 'team_activity(timestamptz)', 'agent_activity_feed(timestamptz, timestamptz, uuid, integer)',
    'va_shift_week(date, integer, uuid)', 'va_shifts_today(date)', 'admin_ad_costs(date, date)',
    'admin_list_profiles()', 'admin_agent_activity()']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
    execute format('revoke execute on function public.%s from public, anon, authenticated',
                   regexp_replace(f, '^([a-z_]+)\(', '\1_p1013('));
  end loop;
end $$;
