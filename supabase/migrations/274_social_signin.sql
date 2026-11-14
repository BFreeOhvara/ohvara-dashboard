-- 274_social_signin — P999: Sign in with Apple / Google, the in-app terms step, durable rate limits, and the
-- admin "real agents" check.
--
-- 1. handle_new_user: a first Google or Apple sign-in makes an agent account, but only while public sign-up is
--    on (app_settings.self_signup_open), exactly like the sign-up page. The provider comes from raw_app_meta_data,
--    which only Supabase Auth writes (never from user_metadata, which the person signing up controls: P770). An
--    email/password sign-up straight to Auth still has no role and is still refused. Someone whose email already
--    has an account is linked to it by Supabase (same email), so this trigger doesn't run for them.
--    The account is a self-signup (locked until they pay); the terms are accepted in the app's next step.
-- 2. accept_signup_terms(version): that step. Only the signed-in agent's own row, only while unset.
-- 3. rate_hit(bucket, key, max, seconds): a durable counter for the public functions (account-email,
--    username-sign-in, claim-invite, submit-mp-lead). Service role only. Rows older than a day are swept.
-- 4. admin_agent_activity(): per agent, paying and/or active, so the admin lists can hide sign-ups that did nothing.

-- ── 1. Sign-up trigger ─────────────────────────────────────────────────────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  colors text[] := array['red', 'blue', 'green', 'yellow'];
  v_role text := new.raw_app_meta_data->>'role';
  v_provider text := new.raw_app_meta_data->>'provider';
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

  -- P999: Google / Apple, while sign-up is open. Same rules as a sign-up-page account.
  if v_role is null and v_provider in ('google', 'apple')
     and coalesce((select self_signup_open from app_settings where id = 1), false) then
    v_role := 'agent';
    v_source := 'self';
  end if;

  if v_role is null or v_role not in ('agent', 'fulfillment') then
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
$$;

-- ── 2. Terms step for Google / Apple accounts ──────────────────────────────
create or replace function public.accept_signup_terms(p_version text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_version is null or length(p_version) not between 6 and 20 then
    raise exception 'Unknown terms version' using errcode = '22023';
  end if;
  update profiles set terms_version = p_version, terms_accepted_at = now()
   where id = auth.uid() and role = 'agent' and terms_accepted_at is null;
  return found;
end;
$$;
revoke execute on function public.accept_signup_terms(text) from public, anon;
grant execute on function public.accept_signup_terms(text) to authenticated;

-- ── 3. Durable rate limit for the public functions ─────────────────────────
create table if not exists public.rate_hits (
  bucket   text not null,
  key_hash text not null,
  at       timestamptz not null default now()
);
create index if not exists rate_hits_lookup_idx on public.rate_hits (bucket, key_hash, at);
create index if not exists rate_hits_at_idx on public.rate_hits (at);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from public, anon, authenticated;
comment on table public.rate_hits is
  'P999: one row per call to a rate-limited public function (salted hash of the IP or email, never the value). Swept after a day.';

-- Records one hit and says whether this key is now OVER p_max hits in the last p_seconds.
create or replace function public.rate_hit(p_bucket text, p_key text, p_max int, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_bucket is null or p_key is null or p_max < 1 or p_seconds not between 1 and 86400 then
    raise exception 'Bad rate limit call' using errcode = '22023';
  end if;
  -- One sweep in ~50 calls keeps the table small without a cron job.
  if random() < 0.02 then delete from rate_hits where at < now() - interval '1 day'; end if;
  insert into rate_hits (bucket, key_hash, at) values (p_bucket, p_key, now());
  select count(*) into n from rate_hits
   where bucket = p_bucket and key_hash = p_key and at > now() - make_interval(secs => p_seconds);
  return n > p_max;
end;
$$;
revoke execute on function public.rate_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.rate_hit(text, text, int, int) to service_role;

-- ── 4. Which agents are real: paying or doing something ────────────────────
-- Paying: a plan, paid Servicing or Leads (the portal lock's own test; has_servicing defaults on), comped, or the setup fee paid. Active: uploaded their own clients or leads,
-- reactivation activity, a booked lead, or a policy. Admins only.
create or replace function public.admin_agent_activity()
returns table (agent_id uuid, paying boolean, active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
  select p.id,
         (coalesce(p.billing_exempt, false)
          or p.billing_status in ('active', 'trialing', 'past_due')
          or public.servicing_active(p.id)
          or public.leads_active(p.id)
          or exists (select 1 from agent_billing_plans b where b.agent_id = p.id and b.setup_paid_at is not null)) as paying,
         (exists (select 1 from client_import_batches c where c.agent_id = p.id)
          or exists (select 1 from reactivation_lists r where r.agent_id = p.id)
          or exists (select 1 from reactivation_contacts r where r.agent_id = p.id)
          or exists (select 1 from leads l where l.assigned_rep_id = p.id and l.appointment_at is not null)
          or exists (select 1 from policies x where x.agent_id = p.id and not coalesce(x.is_demo, false))) as active
    from profiles p
   where p.role = 'agent' and p.deleted_at is null;
end;
$$;
revoke execute on function public.admin_agent_activity() from public, anon;
grant execute on function public.admin_agent_activity() to authenticated;
