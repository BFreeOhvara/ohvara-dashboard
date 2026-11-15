-- 275 — P1004: a real admin invite, sent only by the owner, and the owner payouts switch (off).
--
-- Brayden (Nov 14): "I want our admin accounts to be pretty identical. When I send Jordan his invite, he creates his
-- account." Admins are identical except one thing: only the owner (Brayden) can invite another admin.
--   1. profiles.is_owner — Brayden's account. Nobody changes it from the portal (the privileged-column guard).
--   2. is_owner() — the caller is the active owner admin.
--   3. rep_invites may carry role 'admin'; an admin invite row can only be made by the owner (RLS insert check),
--      and send-agent-invite / claim-invite check the same thing on the server.
--   4. handle_new_user accepts 'admin' — it still only ever comes from app_metadata or pending_signups, which only
--      the service role writes (claim-invite), never from a public sign-up.
--   5. app_settings.owner_payouts_on (false) + owner_split_pct (50: Brayden's share, Jordan gets the rest). Only CC
--      changes them, with Brayden's yes (live_flags_guard, like show_sample_data). Payouts stay OFF.
-- Admin invites and role changes are already in the audit log: audit_rep_invites (insert/update/delete),
-- audit_profiles_insdel (the new admin's profile) and audit_profiles (role, is_active; is_owner added here).

-- 1. The owner flag ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_owner boolean not null default false;
create unique index if not exists profiles_one_owner on public.profiles (is_owner) where is_owner;
update public.profiles set is_owner = true
 where id = '5164aa43-e803-41c5-b96f-1663a53c7404' and role = 'admin' and not is_owner;

-- The privileged-column guard (as it is live today) plus is_owner: never changed from the portal.
create or replace function public.profiles_guard_privileged()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Change role or access from the Users page' using errcode = '42501';
    end if;
    if new.is_demo is distinct from old.is_demo or new.deleted_at is distinct from old.deleted_at
       or new.is_owner is distinct from old.is_owner then
      raise exception 'That part of a profile can''t be changed' using errcode = '42501';
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
    or new.has_servicing                    is distinct from old.has_servicing
    or new.signup_source                    is distinct from old.signup_source
    or new.terms_accepted_at                is distinct from old.terms_accepted_at
    or new.terms_version                    is distinct from old.terms_version
    or new.leads_status                     is distinct from old.leads_status
    or new.leads_weekly_cents               is distinct from old.leads_weekly_cents
    ) then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles for each row
  execute function audit_row('role', 'is_active', 'is_owner', 'upline_id', 'billing_exempt', 'billing_tier', 'stripe_account_id', 'has_servicing');

-- 2. is_owner() ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_owner()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active and is_owner
  )
$function$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

-- 3. Admin invites ──────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.rep_invites drop constraint if exists rep_invites_role_check;
alter table public.rep_invites add constraint rep_invites_role_check
  check (role = any (array['agent'::user_role, 'fulfillment'::user_role, 'admin'::user_role]));

drop policy if exists rep_invites_insert on public.rep_invites;
create policy rep_invites_insert on public.rep_invites for insert to authenticated
  with check (created_by = auth.uid() and public.is_admin() and (role <> 'admin'::user_role or public.is_owner()));

-- 4. handle_new_user: 'admin' allowed (only ever from the service role's app_metadata / pending_signups) ──────────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  colors text[] := array['red', 'blue', 'green', 'yellow'];
  v_role text := new.raw_app_meta_data->>'role';
  v_provider text := new.raw_app_meta_data->>'provider';
  v_pending_role text;
  v_source text;
  v_terms_version text;
  v_terms_accepted_at timestamptz;
begin
  delete from pending_signups where created_at < now() - interval '1 hour';

  delete from pending_signups where email = lower(new.email)
    returning role, source, terms_version, terms_accepted_at
    into v_pending_role, v_source, v_terms_version, v_terms_accepted_at;
  v_role := coalesce(v_role, v_pending_role);

  -- P999: Google / Apple, while sign-up is open. Same rules as a sign-up-page account.
  if v_role is null and v_provider in ('google', 'apple')
     and coalesce((select self_signup_open from app_settings where id = 1), false) then
    v_role := 'agent';
    v_source := 'self';
  end if;

  -- P1004: 'admin' only from an owner's admin invite (claim-invite, service role).
  if v_role is null or v_role not in ('agent', 'fulfillment', 'admin') then
    raise exception 'Accounts are made from an invite only' using errcode = '42501';
  end if;
  insert into profiles (id, email, full_name, role, username, avatar_color,
                        signup_source, terms_version, terms_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), new.email),
    v_role::user_role,
    new.raw_user_meta_data->>'username',
    colors[floor(random() * array_length(colors, 1) + 1)::int],
    coalesce(v_source, 'invite'),
    v_terms_version,
    v_terms_accepted_at
  );
  return new;
end;
$function$;

-- 5. Owner payouts: off, split 50/50, changed only by CC with Brayden's yes ─────────────────────────────────────────
alter table public.app_settings add column if not exists owner_payouts_on boolean not null default false;
alter table public.app_settings add column if not exists owner_split_pct smallint not null default 50;
alter table public.app_settings drop constraint if exists app_settings_owner_split_pct_check;
alter table public.app_settings add constraint app_settings_owner_split_pct_check check (owner_split_pct between 0 and 100);

drop trigger if exists app_settings_live_guard on public.app_settings;
create trigger app_settings_live_guard before update on public.app_settings for each row
  execute function live_flags_guard('show_sample_data', 'owner_payouts_on', 'owner_split_pct');
