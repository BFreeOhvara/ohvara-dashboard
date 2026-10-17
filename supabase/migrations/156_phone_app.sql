-- 156_phone_app.sql — Prompt 775: the Ohvara phone app.
--
-- 1. Demo accounts for App Review (profiles.is_demo, set only by the service
--    role). Everything a demo account does stays on the demo side, enforced
--    here, not in the app:
--      - its bookings are demo bookings (policies.is_demo, stamped from the
--        booking agent, can't be changed) and only ever go to a demo rep;
--        real reps never get one and a demo rep never gets a real one;
--      - real users (admins included) don't see demo bookings and demo users
--        don't see real ones (restrictive RLS on policies + the tables keyed
--        by policy_id);
--      - no texts (demo agents can't turn on text follow-up), no caller ID, no
--        billing (always exempt), no rep pay (claim refuses), no emails, no
--        messages or alerts crossing to real people.
--    Calls are refused in the call functions (fulfillment-call /
--    fulfillment-voice / twilio-token, P775 edge changes).
-- 2. Phone alerts (push): device tokens per user (push_devices, read-own RLS,
--    written only through push_register / push_unregister), a queue
--    (notification_pushes) filled by notify() for push-eligible types when the
--    person's switch is on, same quiet hours as email, sent by notify-push.
-- 3. Delete my account: account_delete(uid), service role only, called by the
--    delete-account function after it has cancelled the agent's Stripe plan.
--    What's deleted vs kept: brain/Account Deletion.md (vault).
-- 4. demo_seed(agent, rep): sample data for the App Review logins
--    (app-review-logins function).

-- ── 1. Demo accounts ───────────────────────────────────────────────────────

alter table public.profiles add column if not exists is_demo boolean not null default false;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.policies add column if not exists is_demo boolean not null default false;
create index if not exists policies_is_demo_idx on public.policies (is_demo) where is_demo;

create or replace function public.my_is_demo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_demo from profiles where id = auth.uid()), false)
$$;

-- Demo side of a booking: the booking's own flag, else (a booking being made
-- right now, not saved yet) the person making it.
create or replace function public.policy_is_demo(p_policy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_demo from policies where id = p_policy), public.my_is_demo())
$$;

-- Nobody signed in can set is_demo or deleted_at (admins included).
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
    ) then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A demo profile is never billed, never texts clients, never uses caller ID.
create or replace function public.profiles_demo_locks()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_demo then
    new.billing_exempt := true;
    new.billing_status := 'exempt';
    new.no_answer_sms_opt_in := false;
    new.caller_id_enabled := false;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_demo_locks on public.profiles;
create trigger profiles_demo_locks before insert or update on public.profiles
  for each row execute function public.profiles_demo_locks();

-- Bookings take the booking agent's side, once, for good. Runs before every
-- other policies trigger (a1_ sorts after a0_block_inactive_writer only).
create or replace function public.policies_demo_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.is_demo := coalesce((select is_demo from profiles where id = new.agent_id), false);
  else
    new.is_demo := old.is_demo;
  end if;
  return new;
end;
$$;
drop trigger if exists a1_policies_demo on public.policies;
create trigger a1_policies_demo before insert or update on public.policies
  for each row execute function public.policies_demo_stamp();

-- Last line: a booking is never held by a rep from the other side. Sorts
-- after policies_fulfillment_autoassign, so it sees the final pick.
create or replace function public.policies_demo_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_fulfillment_id is not null
     and coalesce((select is_demo from profiles where id = new.assigned_fulfillment_id), false) is distinct from new.is_demo then
    new.assigned_fulfillment_id := null;
    new.fulfillment_claimed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists policies_zz_demo_guard on public.policies;
create trigger policies_zz_demo_guard before insert or update on public.policies
  for each row execute function public.policies_demo_guard();

-- Rep picking and free-slot checks only count reps on the booking's side.
create or replace function public.fulfillment_pick_rep(p_at timestamp with time zone, p_policy uuid default null, p_exclude uuid default null, p_prefer uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  with side as (select public.policy_is_demo(p_policy) as demo),
  reps as (
    select id from profiles, side
    where role = 'fulfillment' and is_active
      and is_demo = side.demo
      and id is distinct from p_exclude
  ),
  stats as (
    select r.id,
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
    group by r.id
  )
  select id from stats
  order by (conflicts > 0),
           (p_prefer is not null and id = p_prefer) desc,
           load,
           last_assigned nulls first,
           id
  limit 1
$$;

create or replace function public.fulfillment_rep_free(p_rep uuid, p_at timestamp with time zone, p_policy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_rep is not null and exists (
    select 1 from profiles r
     where r.id = p_rep and r.role = 'fulfillment' and r.is_active
       and r.is_demo = public.policy_is_demo(p_policy)
       and not exists (
         select 1 from policies po
          where po.assigned_fulfillment_id = r.id
            and po.fulfillment_assigned
            and po.fulfillment_stage is distinct from 'Complete'
            and po.id is distinct from p_policy
            and po.scheduled_call_at is not null
            and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800))
$$;

create or replace function public.fulfillment_slot_free(p_at timestamp with time zone, p_policy uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles r
    where r.role = 'fulfillment' and r.is_active
      and r.is_demo = public.policy_is_demo(p_policy)
      and not exists (
        select 1 from policies po
        where po.assigned_fulfillment_id = r.id
          and po.fulfillment_assigned
          and po.fulfillment_stage is distinct from 'Complete'
          and po.id is distinct from p_policy
          and po.scheduled_call_at is not null
          and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800
      )
  )
$$;

-- Admin "give this call to": only a rep on the call's side.
create or replace function public.admin_give_call(p_policy uuid, p_to uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pol       policies;
  v_actor   uuid := auth.uid();
  v_name    text;
  v_to_name text;
  v_from    text;
  v_client  text;
  v_clash   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can give a call to someone else' using errcode = '42501';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This call is finished' using errcode = '22023';
  end if;
  if pol.call_live_since is not null then
    raise exception 'This call is live right now' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Fulfillment') into v_to_name
    from profiles where id = p_to and role = 'fulfillment' and is_active and is_demo = pol.is_demo;
  if not found then
    raise exception 'Pick an active Fulfillment person' using errcode = '22023';
  end if;
  if pol.assigned_fulfillment_id is not distinct from p_to then
    raise exception '% already has this call', v_to_name using errcode = '22023';
  end if;

  if pol.scheduled_call_at is not null then
    select po.scheduled_call_at into v_clash
      from policies po
     where po.assigned_fulfillment_id = p_to
       and po.fulfillment_assigned
       and po.fulfillment_stage is distinct from 'Complete'
       and po.id <> pol.id
       and po.scheduled_call_at is not null
       and abs(extract(epoch from po.scheduled_call_at - pol.scheduled_call_at)) < 1800
     limit 1;
    if found then
      raise exception '% already has a call then', v_to_name using errcode = 'P0001';
    end if;
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Admin') into v_name from profiles where id = v_actor;
  select nullif(btrim(full_name), '') into v_from from profiles where id = pol.assigned_fulfillment_id;
  v_client := coalesce(nullif(trim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), ''), 'A client');

  update policies
     set assigned_fulfillment_id = p_to, fulfillment_claimed_at = now()
   where id = p_policy;

  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (pol.id, pol.agent_id, 'reassigned', v_actor, v_name, 'admin',
          jsonb_build_object('from', pol.assigned_fulfillment_id, 'from_name', v_from,
                             'to', p_to, 'to_name', v_to_name,
                             'scheduled_call_at', pol.scheduled_call_at));

  if pol.assigned_fulfillment_id is not null then
    insert into notifications (profile_id, type, message, data)
    values (pol.assigned_fulfillment_id, 'fulfillment_unassigned',
            v_client || ' moved to ' || v_to_name || '''s desk.',
            jsonb_build_object('policy_id', pol.id, 'to', p_to));
  end if;

  return p_to;
end;
$$;

-- Each side sees only its own bookings, and only its own rows of the tables
-- keyed by a booking. Restrictive: it narrows what the existing policies
-- already allow, it never opens anything.
drop policy if exists policies_demo_wall on public.policies;
create policy policies_demo_wall on public.policies as restrictive for all to authenticated
  using (is_demo = (select public.my_is_demo()))
  with check (is_demo = (select public.my_is_demo()));

do $$
declare t text;
begin
  foreach t in array array['policy_messages', 'policy_message_reads', 'policy_events', 'recovery_sms_log',
                           'fulfillment_missed_calls', 'fulfillment_voice_legs', 'policy_fulfillment_details',
                           'fulfillment_cancels', 'fulfillment_recordings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_demo_wall', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.policy_is_demo(policy_id) = (select public.my_is_demo())) with check (public.policy_is_demo(policy_id) = (select public.my_is_demo()))',
      t || '_demo_wall', t);
  end loop;
end $$;

-- Direct messages: only between people on the same side; a demo account has
-- no thread with the admins.
create or replace function public.can_dm_thread(a uuid, p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        (me.role::text = 'agent' and me.id = a and (
          p is null
          or exists (select 1 from public.profiles f where f.id = p and f.role::text = 'fulfillment')
        ))
        or (me.role::text = 'fulfillment' and p = me.id
            and exists (select 1 from public.profiles ag where ag.id = a and ag.role::text = 'agent'))
        or (me.role::text = 'fulfillment' and a = me.id and p is null)
        or (me.role::text = 'admin' and p is null
            and exists (select 1 from public.profiles o where o.id = a and o.role::text in ('agent', 'fulfillment')))
      )
      and case
            when coalesce(case when a = me.id then p else a end, null) is null then not me.is_demo
            else me.is_demo = coalesce((select o.is_demo from public.profiles o where o.id = case when a = me.id then p else a end), false)
          end
  )
$$;

-- No rep pay for a demo rep, ever.
create or replace function public.fulfillment_claim_payout(p_rep uuid, p_period_start date, p_run uuid, p_hold boolean default false, p_reason text default null)
returns fulfillment_payouts language plpgsql security definer set search_path = public as $$
declare
  cur public.fulfillment_payouts;
  f   record;
begin
  if coalesce((select is_demo from profiles where id = p_rep), false) then return null; end if;
  select * into cur from fulfillment_payouts where rep_id = p_rep and period_start = p_period_start for update;
  if found and cur.status = 'paid' then return null; end if;
  if found and cur.status = 'approved' then return cur; end if;
  select * into f from public.fulfillment_payable(p_rep, p_period_start);
  if f.amount_cents <= 0 then return null; end if;
  insert into fulfillment_payouts as fo (rep_id, period_start, period_end, amount_cents, cancels, topup_cents, status, run_id, failure_reason)
  values (p_rep, p_period_start, p_period_start + 6, f.amount_cents, f.cancels, f.topup_cents,
          case when p_hold then 'held' else 'approved' end, p_run, case when p_hold then p_reason end)
  on conflict (rep_id, period_start) do update
     set amount_cents = excluded.amount_cents, cancels = excluded.cancels, topup_cents = excluded.topup_cents,
         status = excluded.status, run_id = excluded.run_id, failure_reason = excluded.failure_reason,
         hours = 0, rate_cents = 0
  returning * into cur;
  if not p_hold then
    update fulfillment_cancels set payout_id = cur.id
     where id = any (f.cancel_ids) and payout_id is distinct from cur.id;
  end if;
  return cur;
end;
$$;

-- ── 2. Phone alerts (push) ─────────────────────────────────────────────────

create table if not exists public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  app_build    text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_profile_idx on public.push_devices (profile_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select on public.push_devices to authenticated;
drop policy if exists push_devices_own on public.push_devices;
create policy push_devices_own on public.push_devices for select to authenticated using (profile_id = auth.uid());

create table if not exists public.notification_pushes (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  type            text not null,
  title           text not null,
  body            text,
  link            text,
  send_after      timestamptz not null default now(),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'expired', 'no_device')),
  attempts        int not null default 0,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (notification_id)
);
create index if not exists notification_pushes_due_idx on public.notification_pushes (send_after) where status = 'queued';
alter table public.notification_pushes enable row level security;
revoke all on public.notification_pushes from anon, authenticated;

-- Phone alerts switch: on unless they turned it off.
create or replace function public.push_on(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (notification_prefs ->> 'push')::boolean from profiles where id = p_profile), true)
$$;

create or replace function public.push_register(p_token text, p_platform text, p_app_build text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'Unknown phone type' using errcode = '22023'; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 4096 then
    raise exception 'That isn''t a device token' using errcode = '22023';
  end if;
  -- A phone that was someone else's (they signed out, this person signed in) moves over.
  insert into push_devices (profile_id, token, platform, app_build)
  values (auth.uid(), p_token, p_platform, left(p_app_build, 32))
  on conflict (token) do update
     set profile_id = excluded.profile_id, platform = excluded.platform,
         app_build = excluded.app_build, last_seen_at = now();
end;
$$;

create or replace function public.push_unregister(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from push_devices where token = p_token and profile_id = auth.uid()
$$;

create or replace function public.set_push_enabled(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  update profiles
     set notification_prefs = coalesce(notification_prefs, '{}'::jsonb) || jsonb_build_object('push', coalesce(p_on, false))
   where id = auth.uid();
end;
$$;

create or replace function public.my_push_settings()
returns table (push_on boolean, devices int) language sql stable security definer set search_path = public as $$
  select public.push_on(auth.uid()), (select count(*)::int from push_devices where profile_id = auth.uid())
   where auth.uid() is not null
$$;

create or replace function public.notify_queue_push(p_to uuid, p_type text, p_notification uuid, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t notification_types;
begin
  select * into t from notification_types where type = p_type;
  if t.type is null or not t.push then return; end if;
  if not public.push_on(p_to) then return; end if;
  if not exists (select 1 from push_devices where profile_id = p_to) then return; end if;
  insert into notification_pushes (profile_id, notification_id, type, title, body, link, send_after)
  values (p_to, p_notification, p_type, p_title, nullif(p_body, ''), p_link, public.notify_send_after(p_to, t.money))
  on conflict (notification_id) do nothing;
end;
$$;

-- Claim what's due (12 hours late = too stale to be useful: expired). Each
-- row carries the person's phones and their unread count for the app badge.
create or replace function public.notify_claim_pushes(p_limit int default 50)
returns table (id uuid, profile_id uuid, type text, title text, body text, link text, devices jsonb, badge int)
language plpgsql security definer set search_path = public as $$
begin
  update notification_pushes q set status = 'expired'
   where q.status = 'queued' and q.send_after < now() - interval '12 hours';
  return query
  with due as (
    select q.id from notification_pushes q
     where q.status = 'queued' and q.send_after <= now()
     order by q.send_after limit p_limit for update skip locked
  ), upd as (
    update notification_pushes q set status = 'sending', attempts = q.attempts + 1
      from due where q.id = due.id
    returning q.id, q.profile_id, q.type, q.title, q.body, q.link
  )
  select upd.id, upd.profile_id, upd.type, upd.title, upd.body, upd.link,
         coalesce((select jsonb_agg(jsonb_build_object('token', d.token, 'platform', d.platform))
                     from push_devices d where d.profile_id = upd.profile_id), '[]'::jsonb),
         (select count(*)::int from notifications n
           where n.profile_id = upd.profile_id and n.in_bell and n.title is not null and not n.read)
    from upd;
end;
$$;

-- Result of one push: sent (to at least one phone), or a retry (3 tries, 2
-- minutes apart). Tokens the store said are gone are deleted.
create or replace function public.notify_finish_push(p_id uuid, p_ok boolean, p_error text default null, p_dead text[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_dead is not null and cardinality(p_dead) > 0 then
    delete from push_devices where token = any (p_dead);
  end if;
  update notification_pushes q
     set status = case when p_ok then 'sent'
                       when p_error = 'no_device' then 'no_device'
                       when q.attempts >= 3 then 'failed' else 'queued' end,
         send_after = case when p_ok or q.attempts >= 3 then q.send_after else now() + interval '2 minutes' end,
         sent_at = case when p_ok then now() end,
         error = left(p_error, 500)
   where q.id = p_id;
end;
$$;

-- ── notify(): demo wall + push ─────────────────────────────────────────────

-- Whether a notification comes from the demo side: the person whose action
-- caused it, or the booking / cancel / rep it is about.
create or replace function public.notify_from_demo(p_data jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v uuid;
begin
  if public.my_is_demo() then return true; end if;
  begin
    v := nullif(p_data ->> 'policy_id', '')::uuid;
    if v is not null and exists (select 1 from policies where id = v and is_demo) then return true; end if;
    v := nullif(p_data ->> 'cancel_id', '')::uuid;
    if v is not null and exists (select 1 from fulfillment_cancels c join policies p on p.id = c.policy_id where c.id = v and p.is_demo) then return true; end if;
    v := nullif(p_data ->> 'rep_id', '')::uuid;
    if v is not null and exists (select 1 from profiles where id = v and is_demo) then return true; end if;
  exception when invalid_text_representation then
    return false;
  end;
  return false;
end;
$$;

create or replace function public.notify(p_to uuid, p_type text, p_title text, p_detail text, p_link text, p_needs_action boolean default false, p_dedupe text default null, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t   notification_types;
  nid uuid;
  v_demo boolean;
begin
  if p_to is null then return null; end if;
  select * into t from notification_types where type = p_type;
  if t.type is null then raise exception 'Unknown notification type %', p_type; end if;
  if not t.fires then return null; end if;
  select is_demo into v_demo from profiles where id = p_to and coalesce(is_active, true);
  if not found then return null; end if;
  -- P775: nothing from the demo side reaches a real person.
  if not v_demo and public.notify_from_demo(coalesce(p_data, '{}'::jsonb)) then return null; end if;
  insert into notifications (profile_id, type, message, title, detail, link, data, needs_action, dedupe_key, in_bell, push)
  values (p_to, p_type, p_title, p_title, p_detail, p_link, coalesce(p_data, '{}'::jsonb), p_needs_action, p_dedupe, t.in_bell, t.push)
  on conflict (profile_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into nid;
  if nid is not null then
    perform public.notify_queue_email(p_to, p_type, p_title, coalesce(p_detail, ''), p_link, 'n:' || nid::text, nid);
    perform public.notify_queue_push(p_to, p_type, nid, p_title, coalesce(p_detail, ''), p_link);
  end if;
  return nid;
end;
$$;

-- No emails to demo accounts (their addresses aren't real inboxes).
create or replace function public.notify_queue_email(p_to uuid, p_type text, p_subject text, p_body text, p_link text, p_dedupe text, p_notification uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t notification_types;
begin
  select * into t from notification_types where type = p_type;
  if t.type is null or t.email_via is distinct from 'notify' then return; end if;
  if coalesce((select is_demo from profiles where id = p_to), false) then return; end if;
  if not coalesce(public.notify_email_on(p_to, p_type), false) then return; end if;
  if nullif(btrim(coalesce((select email from profiles where id = p_to), '')), '') is null then return; end if;
  insert into notification_emails (profile_id, type, notification_id, dedupe_key, subject, body, link, send_after)
  values (p_to, p_type, p_notification, p_dedupe, p_subject, p_body, p_link, public.notify_send_after(p_to, t.money))
  on conflict (dedupe_key) do nothing;
end;
$$;

-- Admins hear when someone deletes their account (bell + email).
insert into notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
values ('account_deleted', array['admin'], 'Someone deleted their account', true, 'notify', true, false, false, true, 95)
on conflict (type) do nothing;

-- ── 3. Delete my account ───────────────────────────────────────────────────

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

-- ── 4. App Review sample data ──────────────────────────────────────────────

-- Marks the two accounts demo and gives the agent a small, made-up book: three
-- calls coming up, one no answer, two cancelled. 555-01xx numbers (never real).
-- Re-running clears and re-creates their sample bookings.
create or replace function public.demo_seed(p_agent uuid, p_rep uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tz  text := 'America/Chicago';
  d0  date := (now() at time zone tz)::date;
  day date;
  i   int := 0;
  pid uuid;
  rows int := 0;
  r   record;
begin
  if (select role::text from profiles where id = p_agent) is distinct from 'agent'
     or (select role::text from profiles where id = p_rep) is distinct from 'fulfillment' then
    raise exception 'Need one agent and one Fulfillment account' using errcode = '22023';
  end if;

  update profiles set is_demo = true, timezone = tz, timezone_confirmed_at = now()
   where id in (p_agent, p_rep);
  update profiles set full_name = 'Avery Demo (App Review)' where id = p_agent;
  update profiles set full_name = 'Riley Demo (App Review)' where id = p_rep;

  delete from policies where agent_id = p_agent and is_demo;

  for r in
    select * from (values
      ('Maria',  'Lopez',   '(555) 010-0101', 'Dallas',      'TX', 1, 10, 'Pending',  false, null),
      ('James',  'Carter',  '(555) 010-0102', 'Tulsa',       'OK', 1, 14, 'Pending',  false, null),
      ('Linda',  'Nguyen',  '(555) 010-0103', 'Little Rock', 'AR', 2, 11, 'Pending',  false, null),
      ('Robert', 'Hughes',  '(555) 010-0104', 'Shreveport',  'LA', 1, 16, 'Pending',  true,  null),
      ('Patricia','Brooks', '(555) 010-0105', 'Austin',      'TX', -2, 10, 'Complete', false, 'CX-DEMO-1001'),
      ('Michael','Reed',    '(555) 010-0106', 'Wichita',     'KS', -3, 15, 'Complete', false, 'CX-DEMO-1002')
    ) v(first, last, phone, city, st, dd, hh, stage, no_answer, conf)
  loop
    i := i + 1;
    day := d0 + r.dd;
    -- Weekdays only, like real bookings.
    while extract(isodow from day) >= 6 loop day := day + sign(r.dd)::int; end loop;
    insert into policies (agent_id, status, client_first_name, client_last_name, client_phone, client_city, state,
                          client_timezone, carrier_name, pending_underwriting, fulfillment_assigned, fulfillment_stage,
                          assigned_fulfillment_id, fulfillment_claimed_at, scheduled_call_at,
                          last_call_outcome, last_call_at, call_attempts,
                          fulfillment_completed_at, cancellation_status, cancellation_confirmation)
    values (p_agent, 'Submitted', r.first, r.last, r.phone, r.city, r.st,
            tz, 'Sample Life Insurance Co.', false, true, r.stage::fulfillment_stage_status,
            p_rep, now(), ((day + make_time(r.hh, 0, 0)) at time zone tz),
            case when r.no_answer then 'no_answer' end, case when r.no_answer then now() - interval '1 day' end,
            case when r.no_answer then 1 else 0 end,
            case when r.stage = 'Complete' then ((day + make_time(r.hh, 20, 0)) at time zone tz) end,
            case when r.stage = 'Complete' then 'Cancellation Complete'::cancellation_status end,
            r.conf)
    returning id into pid;
    insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
    values (pid, r.first || ' ' || r.last, 'Sample Life Insurance Co.');
    rows := rows + 1;
  end loop;

  return jsonb_build_object('agent', p_agent, 'rep', p_rep, 'bookings', rows);
end;
$$;
revoke all on function public.demo_seed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_seed(uuid, uuid) to service_role;

-- ── pg_cron: send due pushes every minute (only when something is due) ─────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-push') then
    perform cron.unschedule('notify-push');
  end if;
  perform cron.schedule('notify-push', '* * * * *', $cron$
    select public.fulfillment_cron_post('notify-push', '{}'::jsonb)
     where exists (select 1 from public.notification_pushes where status = 'queued' and send_after <= now())
  $cron$);
end $$;

revoke all on function public.notify_claim_pushes(int) from public, anon, authenticated;
revoke all on function public.notify_finish_push(uuid, boolean, text, text[]) from public, anon, authenticated;
revoke all on function public.notify_queue_push(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_from_demo(jsonb) from public, anon, authenticated;
grant execute on function public.notify_claim_pushes(int) to service_role;
grant execute on function public.notify_finish_push(uuid, boolean, text, text[]) to service_role;

-- Applied live as 156b_phone_app_grants: nothing new is callable signed out;
-- trigger functions and push_on are internal only.
revoke all on function public.my_is_demo() from public, anon;
revoke all on function public.policy_is_demo(uuid) from public, anon;
revoke all on function public.push_on(uuid) from public, anon, authenticated;
revoke all on function public.push_register(text, text, text) from public, anon;
revoke all on function public.push_unregister(text) from public, anon;
revoke all on function public.set_push_enabled(boolean) from public, anon;
revoke all on function public.my_push_settings() from public, anon;
revoke all on function public.policies_demo_stamp() from public, anon, authenticated;
revoke all on function public.policies_demo_guard() from public, anon, authenticated;
revoke all on function public.profiles_demo_locks() from public, anon, authenticated;
grant execute on function public.my_is_demo() to authenticated, service_role;
grant execute on function public.policy_is_demo(uuid) to authenticated, service_role;
grant execute on function public.push_on(uuid) to service_role;
grant execute on function public.push_register(text, text, text) to authenticated;
grant execute on function public.push_unregister(text) to authenticated;
grant execute on function public.set_push_enabled(boolean) to authenticated;
grant execute on function public.my_push_settings() to authenticated;
