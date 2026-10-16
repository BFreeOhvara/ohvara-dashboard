-- 152 — Admin hardening, area 3: who becomes an admin (Prompt 770-1).
--
-- Public sign-up is on in Auth, and handle_new_user copied `role` from the
-- sign-up's user_metadata, which the person signing up writes themselves. So
-- anyone with the site's public key could sign up as an admin. Now:
--   * a new account's role comes only from app_metadata, which only the
--     service role can set (claim-invite), and it must be agent or
--     fulfillment. Anything else (a plain sign-up) is refused;
--   * an invite can only be for agent or fulfillment;
--   * nobody signed in can change a role or access by writing profiles
--     directly, admin included. The admin RPCs (admin_set_user_role /
--     admin_set_user_access) still can; they check the caller and the target;
--   * signed-in users can't insert profiles (only the sign-up trigger does);
--   * the last active admin can never be demoted, turned off or deleted, by
--     any path;
--   * is_admin() is false for an admin whose access is off.

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  colors text[] := array['red', 'blue', 'green', 'yellow'];
  v_role text := new.raw_app_meta_data->>'role';
begin
  if v_role is null or v_role not in ('agent', 'fulfillment') then
    raise exception 'Accounts are made from an invite only' using errcode = '42501';
  end if;
  insert into profiles (id, email, full_name, role, username, avatar_color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    v_role::user_role,
    new.raw_user_meta_data->>'username',
    colors[floor(random() * array_length(colors, 1) + 1)::int]
  );
  return new;
end;
$$;

alter table public.rep_invites
  add constraint rep_invites_role_check check (role in ('agent', 'fulfillment'));

create or replace function public.profiles_guard_privileged()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- Role and access change only through the admin RPCs (they run as the
    -- function owner, so they don't reach this branch).
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Change role or access from the Users page' using errcode = '42501';
    end if;
    if not public.is_admin() and (
       new.upline_id                        is distinct from old.upline_id
    or new.stripe_account_id                is distinct from old.stripe_account_id
    or new.stripe_onboarding_complete       is distinct from old.stripe_onboarding_complete
    or new.training_completed               is distinct from old.training_completed
    or new.last_batch_assigned_local_date   is distinct from old.last_batch_assigned_local_date
    or new.leaderboard_rank1_notified_month is distinct from old.leaderboard_rank1_notified_month
    or new.goal_50_notified_month           is distinct from old.goal_50_notified_month
    or new.goal_100_notified_month          is distinct from old.goal_100_notified_month
    or new.created_at                       is distinct from old.created_at
    or new.billing_status                   is distinct from old.billing_status
    or new.stripe_customer_id               is distinct from old.stripe_customer_id
    or new.stripe_subscription_id           is distinct from old.stripe_subscription_id
    or new.billing_current_period_end       is distinct from old.billing_current_period_end
    or new.billing_grace_until              is distinct from old.billing_grace_until
    or new.billing_updated_at               is distinct from old.billing_updated_at
    or new.billing_tier                     is distinct from old.billing_tier
    or new.billing_exempt                   is distinct from old.billing_exempt
    ) then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists profiles_insert_admin on public.profiles;
revoke insert on public.profiles from anon, authenticated;

create or replace function public.profiles_keep_last_admin()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role is distinct from 'admin' or not new.is_active)
     and not exists (select 1 from profiles where id <> old.id and role = 'admin' and is_active) then
    raise exception 'This is the last admin, so it can''t be removed or turned off' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.profiles_keep_last_admin() from public, anon, authenticated;

drop trigger if exists profiles_keep_last_admin on public.profiles;
create trigger profiles_keep_last_admin
  before update of role, is_active or delete on public.profiles
  for each row execute function public.profiles_keep_last_admin();

create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active
  )
$$;
