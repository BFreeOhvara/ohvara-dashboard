-- Prompt 787 — account creation was broken since P770 (migration 152).
--
-- handle_new_user read the role only from raw_app_meta_data, but when an edge
-- function calls auth.admin.createUser({ app_metadata: { role } }), GoTrue
-- inserts the auth.users row first and writes app_metadata afterwards, so the
-- AFTER INSERT trigger never saw the role and refused every account
-- ('Accounts are made from an invite only'). That broke claim-invite (every
-- /join sign-up) and app-review-logins.
--
-- Now the edge function writes the role into pending_signups (service role
-- only: RLS on, no policies, no grants) right before createUser, and the
-- trigger takes it from there by email, deleting the row as it does. A plain
-- public sign-up still can't pick a role: user_metadata is never read for it,
-- and nobody but the service role can write pending_signups.

create table public.pending_signups (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('agent', 'fulfillment')),
  created_at timestamptz not null default now()
);
alter table public.pending_signups enable row level security;
revoke all on public.pending_signups from anon, authenticated;

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
  -- Rows older than an hour are from a createUser that never happened.
  delete from pending_signups where created_at < now() - interval '1 hour';

  if v_role is null then
    delete from pending_signups where email = lower(new.email) returning role into v_role;
  end if;

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
