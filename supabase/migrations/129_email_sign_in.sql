-- Prompt 720 — email-only sign-in.
--
-- Usernames are gone from the portal: new accounts (admin create user, invite
-- claim) are made with a real email and no username. The three legacy
-- accounts that already have one keep it (profiles.username and
-- resolve_login_email stay), so nothing here touches existing rows.

-- Admin-created accounts now save the email they sign in with instead of a
-- username. Old rows keep their username; new rows have only email.
alter table public.rep_credentials alter column username drop not null;
alter table public.rep_credentials add column if not exists email text;

-- Email changes go through Sign-in & security (supabase.auth.updateUser), not
-- the Profile form, so profiles.email follows the auth email once a change is
-- confirmed and the two can't drift apart.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();
