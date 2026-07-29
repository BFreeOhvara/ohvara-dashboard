-- Migration 090 (Prompt 384): real, live-triggered notifications for the 9
-- types Brayden confirmed keeping, superseding [[Prompt 382]]'s preview
-- catalog. Team chat + direct message were already real (migrations
-- 043/084) — this adds the other 4 that are genuine DB-level events (new
-- team member, bug report, lapse check-in, leaderboard/goal milestones).
--
-- "Missed call from a lead" (item 1 of the 9) is NOT included here — see
-- the close-out note in brain/Memories.md. There is no inbound call-routing
-- code anywhere in this repo to hook a trigger into (twilio-voice-webhook
-- only handles the agent's OUTBOUND browser-to-lead dial). Building it needs
-- a design call with Brayden on where the inbound/AI-receptionist call flow
-- actually lives before any trigger can be written.
--
-- Every function below follows migration 084's team_messages_notify()
-- pattern: `security definer set search_path = public` so the insert into
-- `notifications` bypasses RLS regardless of who/what caused the trigger.

-- ============================================================
-- 1. New bug report submitted (admin-only)
-- ============================================================
create or replace function public.bug_reports_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  reporter_name text;
begin
  select full_name into reporter_name from profiles where id = new.reporter_id;

  for recipient in select id from profiles where role = 'admin' loop
    insert into notifications (profile_id, type, message, data)
    values (
      recipient, 'bug_report_submitted',
      'New bug report from ' || coalesce(reporter_name, 'a team member'),
      jsonb_build_object('bug_report_id', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists bug_reports_notify_trigger on bug_reports;
create trigger bug_reports_notify_trigger
  after insert on bug_reports
  for each row execute function public.bug_reports_notify();

-- ============================================================
-- 2. New team member joined (admin-only)
-- ============================================================
-- Fires on any new `profiles` row (created by the handle_new_user trigger
-- on auth.users insert, migration 005 — invite acceptance goes through
-- claim-invite's admin.createUser() call, which is what actually creates
-- the row this trigger reacts to). Excludes 'client' role — a new client
-- signing up isn't "a team member joining."
create or replace function public.profiles_notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
begin
  if new.role = 'client' then
    return new;
  end if;

  for recipient in select id from profiles where role = 'admin' and id != new.id loop
    insert into notifications (profile_id, type, message, data)
    values (
      recipient, 'new_team_member',
      coalesce(new.full_name, 'A new team member') || ' just joined the team',
      jsonb_build_object('profile_id', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists profiles_notify_new_member_trigger on profiles;
create trigger profiles_notify_new_member_trigger
  after insert on profiles
  for each row execute function public.profiles_notify_new_member();

-- ============================================================
-- 3. Lapse check-in due — reuses Prompt 369's next_lapse_check_at column
-- and the existing pg_cron/pg_net setup (migration 002), rather than
-- building a second scheduling mechanism.
-- ============================================================
alter table policies add column if not exists lapse_check_notified_at timestamptz;

-- The two existing RPCs (advance_policy_lapse_check, reactivate_lapsed_policy
-- — migration 085) both push next_lapse_check_at forward. Whenever that
-- column actually changes, the notified flag needs to clear so the NEXT
-- occurrence gets its own notification — this trigger is what makes that
-- automatic instead of needing both RPCs edited by hand.
create or replace function public.reset_lapse_check_notified()
returns trigger
language plpgsql
as $$
begin
  if new.next_lapse_check_at is distinct from old.next_lapse_check_at then
    new.lapse_check_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists policies_reset_lapse_notified on policies;
create trigger policies_reset_lapse_notified
  before update on policies
  for each row execute function public.reset_lapse_check_notified();

-- Daily job: for every In Effect policy whose check-in has come due and
-- hasn't already fired a notification for THIS occurrence, insert one and
-- stamp lapse_check_notified_at in the same statement (atomic — no
-- separate read-then-write race between two agents' policies).
select cron.schedule(
  'notify-lapse-checkins',
  '5 6 * * *',
  $$
    with due as (
      update policies
      set lapse_check_notified_at = now()
      where status = 'In Effect'
        and next_lapse_check_at is not null
        and next_lapse_check_at::date <= current_date
        and lapse_check_notified_at is null
      returning id, agent_id, client_first_name, client_last_name, policy_number
    )
    insert into notifications (profile_id, type, message, data)
    select
      agent_id, 'policy_lapse_checkin',
      'Lapse check-in due: is ' ||
        coalesce(nullif(trim(client_first_name || ' ' || client_last_name), ''), policy_number, 'a policy') ||
        ' still on the books?',
      jsonb_build_object('policy_id', id)
    from due
  $$
);

-- ============================================================
-- 4/5. Leaderboard #1 + monthly goal milestones (50%/100%) — both driven
-- off the same event (a policies write can change either), computed
-- server-side against the exact same "current calendar month, test account
-- excluded" scope Performance.jsx's LeaderboardTab/bookMetrics use
-- client-side, so the numbers can't drift between what's shown and what
-- fires a notification.
--
-- Design call flagged honestly rather than half-built: neither of these
-- had ANY prior server-side representation (LeaderboardTab computes rank
-- fresh in a useMemo every render, and nothing stores a "previous rank"
-- anywhere). Dedup granularity here is per-agent-per-CALENDAR-MONTH, not
-- "every distinct rank change" — e.g. if two agents leapfrog each other
-- for #1 multiple times in one day, only the first crossing fires. This
-- avoids notification spam from ordinary day-to-day jockeying while still
-- catching the "you're #1 this month" moment Brayden asked for. Worth a
-- gut-check with Brayden once this is live for a real month.
-- ============================================================
alter table profiles add column if not exists leaderboard_rank1_notified_month text;
alter table profiles add column if not exists goal_50_notified_month text;
alter table profiles add column if not exists goal_100_notified_month text;

create or replace function public.recompute_leaderboard_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_leader uuid;
  cur_month text := to_char(current_date, 'YYYY-MM');
begin
  select agent_id into new_leader
  from policies
  where agent_id <> '3f2b2df7-40b1-4921-80e2-09981c819642' -- nate44 test account, excluded same as excludeTestAccounts() client-side
    and coalesce(policy_sold_date, created_at::date) >= date_trunc('month', current_date)::date
    and coalesce(policy_sold_date, created_at::date) <  (date_trunc('month', current_date) + interval '1 month')::date
  group by agent_id
  order by sum(annual_premium) desc
  limit 1;

  if new_leader is not null
     and not exists (select 1 from profiles where id = new_leader and leaderboard_rank1_notified_month = cur_month)
  then
    insert into notifications (profile_id, type, message, data)
    values (new_leader, 'leaderboard_rank_change', 'You moved up to #1 on this month''s leaderboard', '{}'::jsonb);

    update profiles set leaderboard_rank1_notified_month = cur_month where id = new_leader;
  end if;

  return null;
end;
$$;

drop trigger if exists policies_recompute_leaderboard on policies;
create trigger policies_recompute_leaderboard
  after insert or update of status, monthly_premium, policy_sold_date, agent_id on policies
  for each row execute function public.recompute_leaderboard_rank();

create or replace function public.check_goal_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  agent uuid := coalesce(new.agent_id, old.agent_id);
  cur_month text := to_char(current_date, 'YYYY-MM');
  submitted_ap numeric;
  goal numeric;
  pct numeric;
begin
  select monthly_ap_goal into goal from profiles where id = agent;
  if goal is null or goal <= 0 then
    return null;
  end if;

  select coalesce(sum(annual_premium), 0) into submitted_ap
  from policies
  where agent_id = agent
    and coalesce(policy_sold_date, created_at::date) >= date_trunc('month', current_date)::date
    and coalesce(policy_sold_date, created_at::date) <  (date_trunc('month', current_date) + interval '1 month')::date;

  pct := submitted_ap / goal * 100;

  if pct >= 100 and not exists (select 1 from profiles where id = agent and goal_100_notified_month = cur_month) then
    insert into notifications (profile_id, type, message, data)
    values (
      agent, 'monthly_goal_milestone',
      'You hit 100% of your monthly goal — ' || to_char(submitted_ap, 'FM$999,999,990') || ' of ' || to_char(goal, 'FM$999,999,990'),
      '{}'::jsonb
    );
    update profiles
    set goal_100_notified_month = cur_month,
        goal_50_notified_month = coalesce(goal_50_notified_month, cur_month)
    where id = agent;
  elsif pct >= 50 and not exists (select 1 from profiles where id = agent and goal_50_notified_month = cur_month) then
    insert into notifications (profile_id, type, message, data)
    values (
      agent, 'monthly_goal_milestone',
      'You hit 50% of your monthly goal — ' || to_char(submitted_ap, 'FM$999,999,990') || ' of ' || to_char(goal, 'FM$999,999,990'),
      '{}'::jsonb
    );
    update profiles set goal_50_notified_month = cur_month where id = agent;
  end if;

  return null;
end;
$$;

drop trigger if exists policies_check_goal_milestones on policies;
create trigger policies_check_goal_milestones
  after insert or update of status, monthly_premium, policy_sold_date, agent_id on policies
  for each row execute function public.check_goal_milestones();
