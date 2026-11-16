-- P1024 (Brayden, Nov 16): people are shown by name, never by email.
--   1. handle_new_user no longer falls back to the email for profiles.full_name. A sign-up that brings no name saves
--      'New user'; the portal shows that as "New user" and asks the person for their first and last name once, at
--      their next sign-in (components/auth/NamePrompt, ProtectedRoute). Everything else in the function is 275's.
--   2. Jordan McNutt's account (the only one whose name was his email) gets his name, with Brayden's yes.
--   3. Any other profile whose name is an email address is set to 'New user' (none on live today).
-- No new function and no grant change (create or replace keeps the existing grants).

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
    -- P1024: never the email. No name given = 'New user' until the person types theirs.
    coalesce(
      nullif(case when new.raw_user_meta_data->>'full_name' like '%@%' then '' else btrim(new.raw_user_meta_data->>'full_name') end, ''),
      nullif(case when new.raw_user_meta_data->>'name' like '%@%' then '' else btrim(new.raw_user_meta_data->>'name') end, ''),
      'New user'),
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

-- Jordan, by his account id (the owner admin's partner); only while his name is still his email.
update public.profiles set full_name = 'Jordan McNutt'
 where id = '41fc2443-507e-45cc-ba0c-27561b591a59' and role = 'admin' and full_name like '%@%';

-- Anyone else whose saved name is an email address.
update public.profiles set full_name = 'New user' where full_name like '%@%';
