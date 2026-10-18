-- Prompt 781 — accounts made from a text-message invite.
--
-- A text invite has no email, so the person types one on /join. The account
-- is made confirmed in Supabase Auth (sign-in needs that: mailer_autoconfirm
-- is off on this project), so "is this email really theirs" is tracked here
-- instead: email_confirm_pending is true until they click the link in the
-- confirmation email (account-email edge function). While it's true the portal
-- shows a "Confirm your email" banner and Forgot password sends nothing.

alter table public.profiles
  add column if not exists email_confirm_pending boolean not null default false;

-- Only the service role (claim-invite / account-email) and admins change it.
create or replace function public.profiles_guard_email_confirm()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin()
     and new.email_confirm_pending is distinct from old.email_confirm_pending then
    raise exception 'That part of a profile can''t be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_email_confirm on public.profiles;
create trigger profiles_guard_email_confirm
  before update on public.profiles
  for each row execute function public.profiles_guard_email_confirm();

-- A changed sign-in email only lands in auth.users after Supabase confirmed
-- the new address, so that also counts as confirmed.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email, email_confirm_pending = false where id = new.id;
  end if;
  return new;
end;
$$;

-- One row per confirmation link sent. Only the sha-256 of the token is kept.
create table if not exists public.email_confirm_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_confirm_tokens_user_idx on public.email_confirm_tokens (user_id, created_at desc);

alter table public.email_confirm_tokens enable row level security;
revoke all on public.email_confirm_tokens from anon, authenticated;
