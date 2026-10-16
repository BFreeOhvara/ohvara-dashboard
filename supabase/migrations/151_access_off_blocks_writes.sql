-- 151 — Fulfillment hardening, area 4: access off means off (Prompt 769-4).
--
-- Turning someone's access off (admin_set_user_access) bans them, deletes
-- their sessions and releases their future calls. But a sign-in token they
-- already hold keeps working against the database until it expires (up to an
-- hour), and nothing in the RPCs looked at is_active. Now:
--   * is_fulfillment() is false for a rep whose access is off, so the RLS
--     policies built on it return nothing; and
--   * anyone whose access is off can't write calls, notes, messages or
--     shifts, by any path (direct or RPC). Admin actions, the cron and edge
--     functions (no signed-in user) are unaffected.

create or replace function public.is_fulfillment()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'fulfillment' and is_active
  )
$$;

create or replace function public.block_inactive_writer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.profiles where id = auth.uid() and not is_active) then
    raise exception 'Your access is off. Message Brayden if that''s a mistake.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.block_inactive_writer() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['policies', 'policy_fulfillment_details', 'policy_messages', 'policy_message_reads',
                           'direct_messages', 'messages', 'fulfillment_time_entries']
  loop
    execute format('drop trigger if exists a0_block_inactive_writer on public.%I', t);
    execute format('create trigger a0_block_inactive_writer before insert or update or delete on public.%I
                    for each row execute function public.block_inactive_writer()', t);
  end loop;
end $$;
