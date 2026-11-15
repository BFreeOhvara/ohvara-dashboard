-- P1017 (Brayden, Nov 15) — real accounts never see sample data, deleting an account frees its email for every role,
-- and the owner fixes a wrong role without deleting anyone.
--
--   1. Sample data is decided per account, on the server: profile_sees_sample(p) = a test account (profiles.is_test,
--      P929) or an admin whose own view (profiles.data_view, new) is 'sample'. Everyone else is real from the first
--      second. Admins default to real. data_view changes only through set_my_data_view() (admins only); the app's
--      company switch (app_settings.show_sample_data) no longer decides anything.
--   2. account_delete: any role may delete their own account (admins too), except the owner and the last active
--      admin. It also cancels (expires, rows kept for the audit trail) every open invite TO that email and drops any
--      staged sign-up for it. delete-account then soft-deletes the login, which scrambles the auth email, phone and
--      Google/Apple identities, so the same email works again for Create account, Google, Apple and invites; the new
--      account is a new id and starts fresh. The old row stays as "Deleted user" for pay/call/audit records only.
--   3. admin_set_user_role: Agent <-> Fulfillment <-> Admin. Making someone an admin, or changing an admin's role, is
--      the owner's only (never the owner's own row, never a test account). Logged by audit_profiles (role).
--   4. admin_set_invite_role: change the role on a pending invite before it's used (Admin: owner only; the owner
--      becomes the invite's sender so claim-invite accepts it). Logged by audit_rep_invites.

-- 1. Per-account sample view ─────────────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists data_view text
  check (data_view is null or data_view in ('sample', 'real'));
comment on column public.profiles.data_view is
  'P1017: an admin''s own Sample/Real view (null = real). Ignored for every other role. Set only by set_my_data_view().';

create or replace function public.profile_sees_sample(p public.profiles)
returns boolean language sql stable set search_path = public as $$
  select p.deleted_at is null and (coalesce(p.is_test, false) or (p.role = 'admin' and coalesce(p.data_view = 'sample', false)));
$$;

create or replace function public.my_data_view()
returns text language sql stable security definer set search_path = public as $$
  select case when public.profile_sees_sample(p) then 'sample' else 'real' end
    from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.set_my_data_view(p_view text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins pick their own view' using errcode = '42501';
  end if;
  if p_view not in ('sample', 'real') then
    raise exception 'Pick sample or real' using errcode = '22023';
  end if;
  update public.profiles set data_view = p_view where id = auth.uid();
  return public.my_data_view();
end;
$$;

-- Nobody sets data_view straight on the table (only the definer function above).
create or replace function public.profiles_guard_data_view()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.data_view is distinct from old.data_view then
    raise exception 'That part of a profile can''t be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_data_view on public.profiles;
create trigger profiles_guard_data_view before update on public.profiles
  for each row execute function public.profiles_guard_data_view();

revoke execute on function public.profile_sees_sample(public.profiles), public.my_data_view(), public.set_my_data_view(text)
  from public, anon;
grant execute on function public.my_data_view(), public.set_my_data_view(text) to authenticated;
grant execute on function public.profile_sees_sample(public.profiles) to authenticated, service_role;

-- 2. account_delete: every role, frees the email ──────────────────────────────────────────────────────────────────
create or replace function public.account_delete(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      profiles;
  v_role  text;
  v_email text;
  v_short text := left(p_uid::text, 8);
  a       record;
  n       jsonb := '{}'::jsonb;
  c       int;
begin
  select * into me from profiles where id = p_uid for update;
  if not found then raise exception 'No such account' using errcode = 'P0002'; end if;
  if me.deleted_at is not null then return jsonb_build_object('already', true); end if;
  -- P1017: admins may delete their own account too, but never the owner, and never the last active admin.
  if me.role::text = 'admin' then
    if me.is_owner then
      raise exception 'The owner account can''t be deleted' using errcode = '42501';
    end if;
    if not exists (select 1 from profiles where id <> p_uid and role = 'admin' and is_active and deleted_at is null) then
      raise exception 'This is the last admin, so it can''t be deleted' using errcode = '42501';
    end if;
  end if;
  v_role := me.role::text;
  v_email := lower(nullif(trim(me.email), ''));

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

  -- P1017: the email is free again. Open invites TO it are cancelled (expired, rows kept for the audit trail) and a
  -- staged sign-up for it is dropped. The login itself is soft-deleted by delete-account right after this.
  if v_email is not null then
    update rep_invites set expires_at = now()
     where lower(invited_email) = v_email and used_at is null and expires_at > now();
    get diagnostics c = row_count; n := n || jsonb_build_object('invites_cancelled', c);
    delete from pending_signups where email = v_email;
  end if;

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
    live_transfer_phone = null, on_duty_default = false, data_view = null,
    is_active = false, deleted_at = now()
  where id = p_uid;

  -- Anyone who had them as upline.
  update profiles set upline_id = null where upline_id = p_uid;

  -- Tell the admins (bell + email). No name: it's gone.
  for a in select id from profiles where role = 'admin' and is_active and deleted_at is null and id <> p_uid loop
    perform public.notify(a.id, 'account_deleted', 'Someone deleted their account',
      initcap(case v_role when 'fulfillment' then 'Fulfillment' else v_role end) || ' account · id ' || v_short || '. Pay and call records were kept.',
      '/admin/users', false, 'deleted:' || p_uid::text, jsonb_build_object('profile_id', p_uid));
  end loop;

  return jsonb_build_object('deleted', true, 'role', v_role) || n;
end;
$$;
revoke execute on function public.account_delete(uuid) from public, anon, authenticated;

-- 3. Role changes: Admin is the owner's ───────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_user_role(p_user uuid, p_role text, p_confirm boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  t      profiles;
  v_cur  text;
  v_open integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change access' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('agent', 'fulfillment', 'admin') then
    raise exception 'Pick Agent, Fulfillment or Admin' using errcode = '22023';
  end if;
  select * into t from profiles where id = p_user for update;
  if not found or t.deleted_at is not null then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  if t.role::text = 'admin' or p_role = 'admin' then
    if not public.is_owner() then
      raise exception 'Only the owner can make someone an admin or change an admin' using errcode = '42501';
    end if;
    if p_user = auth.uid() or t.is_owner then
      raise exception 'You can''t change your own account here' using errcode = '42501';
    end if;
    if coalesce(t.is_test, false) or coalesce(t.is_demo, false) then
      raise exception 'Test accounts keep their role' using errcode = '22023';
    end if;
    v_cur := t.role::text;
    if v_cur = 'fulfillment' and exists (
      select 1 from policies
       where assigned_fulfillment_id = p_user and call_live_since is not null
         and fulfillment_stage is distinct from 'Complete'
    ) then
      raise exception 'They''re on a call right now. Try again after it ends.' using errcode = '22023';
    end if;
  else
    v_cur := public.admin_user_guard(p_user);
  end if;

  if v_cur = p_role then
    return v_cur;
  end if;
  if v_cur in ('agent', 'fulfillment') then
    v_open := public.admin_open_work(p_user, v_cur);
    if v_open > 0 and not coalesce(p_confirm, false) then
      raise exception 'has_open_work' using errcode = 'P0001', detail = v_open::text;
    end if;
  end if;

  update profiles
     set role = p_role::user_role,
         upline_id = case when p_role = 'admin' then null else upline_id end,
         data_view = case when p_role = 'admin' then data_view else null end
   where id = p_user;
  if v_cur = 'fulfillment' then
    perform public.admin_release_calls(p_user);
  end if;
  return p_role;
end;
$$;
revoke execute on function public.admin_set_user_role(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text, boolean) to authenticated;

-- 4. A pending invite's role ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_invite_role(p_invite uuid, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  i rep_invites;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change an invite' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('agent', 'fulfillment', 'admin') then
    raise exception 'Pick Agent, Fulfillment or Admin' using errcode = '22023';
  end if;
  select * into i from rep_invites where id = p_invite for update;
  if not found then
    raise exception 'That invite is gone' using errcode = 'P0002';
  end if;
  if i.used_at is not null or i.expires_at <= now() then
    raise exception 'That invite was already used or has run out' using errcode = '22023';
  end if;
  if (i.role::text = 'admin' or p_role = 'admin') and not public.is_owner() then
    raise exception 'Only the owner can make an admin invite' using errcode = '42501';
  end if;
  if i.role::text = p_role then
    return p_role;
  end if;
  update rep_invites
     set role = p_role::user_role,
         created_by = case when p_role = 'admin' then auth.uid() else created_by end
   where id = p_invite;
  return p_role;
end;
$$;
revoke execute on function public.admin_set_invite_role(uuid, text) from public, anon;
grant execute on function public.admin_set_invite_role(uuid, text) to authenticated;
