-- ============================================================
-- Migration 005 — Username-based authentication
-- Adds username column to profiles. Existing rows (e.g. admin)
-- are unaffected; username is nullable for backwards compat.
-- ============================================================

alter table profiles add column username text;

-- Unique only on non-null rows so the admin account (no username) doesn't conflict
create unique index profiles_username_unique on profiles (username) where username is not null;

-- Update trigger to populate username from user metadata when present
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name, role, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'rep'),
    new.raw_user_meta_data->>'username'
  );
  return new;
end;
$$;
