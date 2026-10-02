-- Block self privilege escalation on profiles.
--
-- profiles_update_self is `using (auth.uid() = id)` with no column limit, and
-- `authenticated` holds UPDATE on every column, so any signed-in user could
-- run update profiles set role = 'admin' on their own row (or flip is_active,
-- re-point upline_id, swap the Stripe payout account...).
--
-- This trigger rejects changes to privileged columns when the statement comes
-- straight from the API as a non-admin. Everything that legitimately writes
-- these columns is unaffected:
--   - admins (profiles_admin_update) — is_admin()
--   - edge functions using the service role — current_user = service_role
--   - security-definer functions owned by postgres (assign_daily_batches,
--     recompute_leaderboard_rank, check_goal_milestones) — current_user = postgres
-- The self-service columns the app writes (name, email, phone, username,
-- timezone, avatar, licensing, overview/weekend prefs, caller_id_enabled)
-- stay writable. caller_id_* verification fields have their own guard (108).

create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.role                             is distinct from old.role
    or new.is_active                        is distinct from old.is_active
    or new.upline_id                        is distinct from old.upline_id
    or new.stripe_account_id                is distinct from old.stripe_account_id
    or new.stripe_onboarding_complete       is distinct from old.stripe_onboarding_complete
    or new.training_completed               is distinct from old.training_completed
    or new.last_batch_assigned_local_date   is distinct from old.last_batch_assigned_local_date
    or new.leaderboard_rank1_notified_month is distinct from old.leaderboard_rank1_notified_month
    or new.goal_50_notified_month           is distinct from old.goal_50_notified_month
    or new.goal_100_notified_month          is distinct from old.goal_100_notified_month
    or new.created_at                       is distinct from old.created_at
    then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged();
