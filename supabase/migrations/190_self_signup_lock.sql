-- 190 — Self-signup: the lock, in the database.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step.
-- The number comes from a scan of branches, not from the ledger: this brief
-- reached the builder without one. If 190 is taken, only this name changes.
-- Additive: new columns, one new table, new functions and triggers, policies
-- re-created with the same name and the same rule plus one condition. No row is
-- changed. self_signup_open stays off.
--
-- Why: "nothing works until they pay for Servicing, Leads, or both... strangers
-- can't get in free." Until now the lock was only in the UI: a public account
-- could write through the API, read staff-only tables, or clear its own flag.
--
-- CONTRACT (the functions, frontend and tests tasks rely on these names):
--   profiles.signup_source / terms_accepted_at / terms_version / leads_status /
--            leads_weekly_cents     read through get_my_profile() or
--                                   admin_list_profiles(); not in the 112 grant.
--   pending_signups.source / terms_version / terms_accepted_at
--   app_settings.self_signup_open   default false.
--   signup_attempts                 service role only.
--   rpc agent_portal_access(p_agent uuid default auth.uid()) returns jsonb
--                                   {"self", "servicing", "leads", "unlocked"}
--   rpc is_locked_self_signup() returns boolean
--   errors (42501): 'Choose a plan to unlock your portal.'
--                   'Add a Servicing plan to submit deals.'
--
-- READS CLOSED for a locked self-signup account (it keeps its own rows):
--   Any signed-in user could read these:
--     profiles (profiles_select: staff directory), commission_schedule,
--     recovery_config, training_videos, carriers, app_settings,
--     notification_types, sms_consent_scripts, team_conversations, team_messages
--   Any agent could read these, and a self-signup account is an agent:
--     appointments, calls (2 policies), clients, commissions, follow_up_queue,
--     no_answer_queue, leads, messages
--   Two functions that hand out the same data whatever RLS says:
--     team_activity (every agent's name, photo, bookings)
--     my_standing_threads (every Fulfillment person's name and photo)
--
-- LEFT OPEN ON PURPOSE: agent_billing_tiers, membership_tiers, lead_prices,
-- prepaid_topup_options. They are the price lists; a locked account has to read
-- them to choose a plan (BillingGate, Settings, BillingPanel, PlanV2Parts,
-- PrepaidBalanceCard).
--
-- NOT A POLICY, NOT CHANGED: a locked account can still upload a file to its own
-- bug-screenshots folder and change its own avatar (storage.objects). The avatar
-- is its profile; the screenshot row can't be saved (bug_reports is blocked).
--
-- ANON: is_locked_self_signup() is not executable by anon, and Postgres checks
-- that when a query starts, even if the condition would never reach it. So the
-- policies below that were `to public` are re-created `to authenticated`, or a
-- signed-out request would get a permission error. Anon saw no rows through them
-- before, with one exception that now stops: team_conversations and team_messages
-- never checked for a signed-in user, so anon could read the channels.

-- ── 1. Who signed up how, and what they've bought ───────────────────────────
alter table public.profiles
  add column if not exists signup_source text not null default 'invite'
    check (signup_source in ('invite', 'self')),
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists leads_status text not null default 'none'
    check (leads_status in ('none', 'active')),
  add column if not exists leads_weekly_cents integer not null default 0;

comment on column public.profiles.signup_source is
  'self = made an account from the public sign-up page. Set once, by handle_new_user, from pending_signups.source.';
comment on column public.profiles.leads_status is
  'active = paying for Leads. For the weekly Leads-spend billing; nothing sets it yet.';

-- The newest body is 187's, not 156's: it is 156 plus has_servicing, and going
-- back to 156 would let an agent turn Servicing back on. Same as 187, plus the
-- five new columns in the admin-only list.
create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Change role or access from the Users page' using errcode = '42501';
    end if;
    if new.is_demo is distinct from old.is_demo or new.deleted_at is distinct from old.deleted_at then
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
$$;

-- ── 2. Sign-up ──────────────────────────────────────────────────────────────
alter table public.pending_signups
  add column if not exists source text not null default 'invite'
    check (source in ('invite', 'self')),
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

-- A self-signup is always an agent: the lock only looks at agents.
alter table public.pending_signups
  drop constraint if exists pending_signups_self_is_agent;
alter table public.pending_signups
  add constraint pending_signups_self_is_agent check (source = 'invite' or role = 'agent');

-- 160, plus source and terms taken with the role and written in the one insert,
-- so there is no later update that could fail and leave a stranger unflagged.
-- The row is now taken every time, not only when app_metadata has no role, so a
-- role in app_metadata can't lose the row's source.
--
-- The "just joined the team" notice: nothing to skip. 146 dropped its trigger
-- (profiles_notify_new_member_trigger) and its notifications_gate drops any
-- old-shape insert, and nothing re-creates either. invite_accepted (146) fires
-- from rep_invites, which a self-signup never touches. So no admin notice goes
-- out for a new profile of either source.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  colors text[] := array['red', 'blue', 'green', 'yellow'];
  v_role text := new.raw_app_meta_data->>'role';
  v_pending_role text;
  v_source text;
  v_terms_version text;
  v_terms_accepted_at timestamptz;
begin
  -- Rows older than an hour are from a createUser that never happened.
  delete from pending_signups where created_at < now() - interval '1 hour';

  delete from pending_signups where email = lower(new.email)
    returning role, source, terms_version, terms_accepted_at
    into v_pending_role, v_source, v_terms_version, v_terms_accepted_at;
  v_role := coalesce(v_role, v_pending_role);

  if v_role is null or v_role not in ('agent', 'fulfillment') then
    raise exception 'Accounts are made from an invite only' using errcode = '42501';
  end if;
  insert into profiles (id, email, full_name, role, username, avatar_color,
                        signup_source, terms_version, terms_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    v_role::user_role,
    new.raw_user_meta_data->>'username',
    colors[floor(random() * array_length(colors, 1) + 1)::int],
    coalesce(v_source, 'invite'),
    v_terms_version,
    v_terms_accepted_at
  );
  return new;
end;
$$;

-- ── 3. The switch, and the sign-up rate limit ───────────────────────────────
-- "Admins update app settings" (091) covers it. Off until Brayden turns it on.
alter table public.app_settings
  add column if not exists self_signup_open boolean not null default false;

comment on column public.app_settings.self_signup_open is
  'On = the public sign-up page makes accounts. Off until Brayden turns it on.';

create table if not exists public.signup_attempts (
  ip_hash    text,
  email_hash text,
  created_at timestamptz default now()
);
create index if not exists signup_attempts_created_at_idx on public.signup_attempts (created_at);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from public, anon, authenticated;
grant select, insert, delete on public.signup_attempts to service_role;

-- ── 4. Who has access to what ───────────────────────────────────────────────
-- Internal: every API role is refused; the functions below run as the owner.
create or replace function public.servicing_active(p_agent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select billing_exempt
        or billing_status = 'active'
        or (billing_status = 'past_due' and billing_grace_until > now())
        or (billing_status = 'canceled' and billing_current_period_end > now())
      from profiles where id = p_agent
  ), false)
$$;

create or replace function public.leads_active(p_agent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select leads_status = 'active' from profiles where id = p_agent), false)
$$;

revoke all on function public.servicing_active(uuid) from public, anon, authenticated, service_role;
revoke all on function public.leads_active(uuid) from public, anon, authenticated, service_role;

-- Inside a definer function current_user is always the owner (see 119), so the
-- service role is told by the role PostgREST switched to and the key's claims.
-- Neither can be set by a caller. With no signed-in user and no service role,
-- p_agent = auth.uid() is null and the call is refused.
create or replace function public.agent_portal_access(p_agent uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role      text;
  v_self      boolean;
  v_servicing boolean;
  v_leads     boolean;
begin
  if not (coalesce(p_agent = auth.uid(), false)
          or public.is_admin()
          or current_setting('role', true) = 'service_role'
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select role::text, signup_source = 'self' into v_role, v_self from profiles where id = p_agent;
  if not found then
    return jsonb_build_object('self', false, 'servicing', false, 'leads', false, 'unlocked', false);
  end if;

  v_servicing := public.servicing_active(p_agent);
  v_leads     := public.leads_active(p_agent);
  return jsonb_build_object(
    'self', v_self,
    'servicing', v_servicing,
    'leads', v_leads,
    'unlocked', v_servicing or v_leads or v_role <> 'agent');
end;
$$;

revoke all on function public.agent_portal_access(uuid) from public, anon;
grant execute on function public.agent_portal_access(uuid) to authenticated, service_role;

-- True for a self-signup agent who has paid for nothing. RLS calls this.
create or replace function public.is_locked_self_signup()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and p.role = 'agent'
       and p.signup_source = 'self'
       and not (public.servicing_active(p.id) or public.leads_active(p.id))
  )
$$;

revoke all on function public.is_locked_self_signup() from public, anon;
grant execute on function public.is_locked_self_signup() to authenticated;

-- ── 5. Writes ───────────────────────────────────────────────────────────────
-- Same shape as block_inactive_writer (151). Keyed on auth.uid(), not
-- current_user, so the agent RPCs (security definer) are stopped too. No
-- signed-in user (service role, cron, edge functions) passes; so does an admin,
-- who is never role agent. Keyed on the writer, not the row's owner, so
-- Fulfillment still works a call on a locked agent's client.
create or replace function public.block_locked_self_signup_writer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.is_locked_self_signup() then
    raise exception 'Choose a plan to unlock your portal.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.block_locked_self_signup_writer() from public, anon, authenticated, service_role;

-- Everything an agent can write, directly or through an RPC, except what stays
-- open: profiles, and Settings' phone alerts and email switches (push_devices
-- and notifications go through their own RPCs, no client writes). Tables only the
-- service role writes (agent_lead_ledger, agent_inbound_spend) don't need it.
-- a0_block_l sorts after a0_block_inactive_writer and before a1_policies_demo.
do $$
declare t text;
begin
  foreach t in array array[
    'policies', 'policy_fulfillment_details', 'policy_messages', 'policy_message_reads',
    'direct_messages', 'direct_message_reads', 'messages', 'team_conversations', 'team_messages',
    'agent_lead_settings', 'agent_duty', 'agent_licenses', 'agent_carrier_appointments', 'agent_monthly_goals',
    'leads', 'inbound_events', 'service_requests', 'servicing_tasks', 'fulfillment_cancels',
    'appointments', 'calls', 'closer_followups', 'training_progress', 'bug_reports']
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists a0_block_locked_self_signup on public.%I', t);
    execute format('create trigger a0_block_locked_self_signup before insert or update or delete on public.%I
                    for each row execute function public.block_locked_self_signup_writer()', t);
  end loop;
end $$;

-- A Leads-only payer has an unlocked portal but no Servicing: no submitting,
-- whatever agent_billing_enforced says. Turning an old row into a booking
-- (fulfillment_assigned false to true) counts as submitting, as it does in 187's
-- guard. Runs after the lock above, so someone with no plan at all hears
-- "Choose a plan".
create or replace function public.block_self_signup_without_servicing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (tg_op = 'INSERT' or (coalesce(new.fulfillment_assigned, false) and not coalesce(old.fulfillment_assigned, false)))
     and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent' and p.signup_source = 'self')
     and not public.servicing_active(auth.uid()) then
    raise exception 'Add a Servicing plan to submit deals.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.block_self_signup_without_servicing() from public, anon, authenticated, service_role;

drop trigger if exists a0_block_self_signup_no_servicing on public.policies;
create trigger a0_block_self_signup_no_servicing before insert or update on public.policies
  for each row execute function public.block_self_signup_without_servicing();

-- ── 6. Reads ────────────────────────────────────────────────────────────────
-- Each policy is dropped and re-created under its own name with the rule the
-- database holds right now, read from pg_policies, plus one condition. Reading
-- it keeps a rule that was changed on the live database out of the migrations
-- folder (it has happened) from being overwritten with an older copy. A policy
-- that isn't there is skipped; one already closed is left alone.
--
-- The middle column is what a locked account keeps: its own rows. Empty means it
-- has no rows of its own in that table (or another policy already gives them).
-- (select ...) runs the check once per query, not once per row (as 156 does).
do $$
declare
  r    record;
  p    record;
  v_gate text;
begin
  for r in
    select * from (values
      -- Any signed-in user
      ('profiles',            'profiles_select',                          'id = auth.uid()'),
      ('commission_schedule', 'commission_schedule_select_authenticated', null),
      ('recovery_config',     'recovery_config_read',                     null),
      ('training_videos',     'training_videos_select',                   null),
      ('carriers',            'carriers_select',                          null),
      ('app_settings',        'Everyone reads app settings',              null),
      ('notification_types',  'Signed-in read notification types',        null),
      ('sms_consent_scripts', 'sms_consent_scripts_read',                 null),
      ('team_conversations',  'team_conversations_select',                'auth.uid() = dm_participant_a or auth.uid() = dm_participant_b'),
      ('team_messages',       'team_messages_select',                     'exists (select 1 from public.team_conversations c where c.id = team_messages.conversation_id and (auth.uid() = c.dm_participant_a or auth.uid() = c.dm_participant_b))'),
      -- Any agent
      ('appointments',        'appointments_closer_select',               'closer_id = auth.uid() or rep_id = auth.uid()'),
      ('calls',               'calls_rep_own',                            'rep_id = auth.uid()'),
      ('calls',               'calls_rep_select',                         'rep_id = auth.uid()'),
      ('clients',             'Closers view clients',                     null),
      ('commissions',         'commissions_select',                       'recipient_id = auth.uid()'),
      ('follow_up_queue',     'fuq_admin_closer_select',                  null),
      ('no_answer_queue',     'naq_admin_closer_select',                  null),
      ('leads',               'leads_rep_select',                         'assigned_rep_id = auth.uid() or assigned_closer_id = auth.uid()'),
      ('messages',            'messages_select_closer_inbox',             null)
    ) as t(tbl, pol, own)
  loop
    select * into p from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.pol;
    if not found then
      raise notice 'No policy % on %, nothing to close', r.pol, r.tbl;
      continue;
    end if;
    if p.qual like '%is_locked_self_signup%' then
      continue;
    end if;

    v_gate := 'not (select public.is_locked_self_signup())';
    if r.own is not null then
      v_gate := r.own || ' or ' || v_gate;
    end if;

    execute format('drop policy if exists %I on public.%I', r.pol, r.tbl);
    execute format('create policy %I on public.%I as %s for %s to authenticated using ((%s) and (%s))%s',
                   r.pol, r.tbl, p.permissive, p.cmd, p.qual, v_gate,
                   case when p.with_check is not null then format(' with check (%s)', p.with_check) else '' end);
  end loop;
end $$;

-- 111, plus the is_locked_self_signup line: every agent's name, photo and bookings.
create or replace function public.team_activity(p_since timestamptz default now() - interval '7 days')
returns table (
  kind text,
  at timestamptz,
  agent_id uuid,
  agent_first_name text,
  avatar_url text,
  avatar_color text
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '35 days') as since
  ),
  events as (
    select 'booked'::text as kind, p.created_at as at, p.agent_id
    from policies p, bounds b
    where p.fulfillment_assigned = true
      and p.created_at >= b.since
    union all
    select 'cancelled'::text, p.fulfillment_completed_at, p.agent_id
    from policies p, bounds b
    where p.fulfillment_assigned = true
      and p.fulfillment_stage = 'Complete'
      and p.fulfillment_completed_at >= b.since
  )
  select e.kind, e.at, e.agent_id,
         split_part(coalesce(nullif(trim(pr.full_name), ''), 'Agent'), ' ', 1),
         pr.avatar_url, pr.avatar_color
  from events e
  join profiles pr on pr.id = e.agent_id
  where public.is_team_member()
    and not public.is_locked_self_signup()
    and pr.role = 'agent'
    and pr.is_active
  order by e.at desc
  limit 500;
$$;

-- 139, plus the is_locked_self_signup line: it listed every Fulfillment person
-- to any agent. A locked account keeps the threads it already has and the one
-- with admin.
create or replace function public.my_standing_threads()
returns table (
  agent_id          uuid,
  agent_name        text,
  peer_id           uuid,
  peer_key          text,
  peer_name         text,
  last_body         text,
  last_sender_id    uuid,
  last_at           timestamptz,
  unread_count      int,
  agent_avatar_url  text,
  agent_avatar_color text,
  peer_avatar_url   text,
  peer_avatar_color text,
  agent_role        text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select pr.id as uid, pr.role::text as role from profiles pr where pr.id = auth.uid()),
  pairs as (
    select me.uid as a, f.id as p
      from me join profiles f on f.role::text = 'fulfillment' and f.is_active
      where me.role = 'agent'
        and (not public.is_locked_self_signup()
             or exists (select 1 from direct_messages d where d.agent_id = me.uid and d.peer_key = f.id::text))
    union all
    select me.uid, null::uuid from me where me.role in ('agent', 'fulfillment')
    union all
    select ag.id, me.uid
      from me join profiles ag on ag.role::text = 'agent' and ag.is_active
      where me.role = 'fulfillment'
    union all
    select o.id, null::uuid
      from me join profiles o on o.role::text in ('agent', 'fulfillment') and o.is_active
      where me.role = 'admin'
  )
  select pa.a, ag.full_name, pa.p, coalesce(pa.p::text, 'admin'), pe.full_name,
         lm.body, lm.sender_id, lm.created_at,
         coalesce((
           select count(*)::int from direct_messages x
           where x.agent_id = pa.a and x.peer_key = coalesce(pa.p::text, 'admin')
             and x.sender_id <> me.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
         ), 0),
         ag.avatar_url, ag.avatar_color, pe.avatar_url, pe.avatar_color,
         ag.role::text
  from pairs pa
  cross join me
  join profiles ag on ag.id = pa.a
  left join profiles pe on pe.id = pa.p
  left join direct_message_reads r
    on r.agent_id = pa.a and r.peer_key = coalesce(pa.p::text, 'admin') and r.profile_id = me.uid
  left join lateral (
    select y.body, y.sender_id, y.created_at from direct_messages y
    where y.agent_id = pa.a and y.peer_key = coalesce(pa.p::text, 'admin')
    order by y.created_at desc limit 1
  ) lm on true
  order by lm.created_at desc nulls last, coalesce(pe.full_name, 'Admin'), ag.full_name;
$$;
