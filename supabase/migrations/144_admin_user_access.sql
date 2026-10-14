-- Prompt 762 — Admin Users: change a person's role (Agent / Fulfillment) and
-- turn their access off or back on. Both admin only, through these two
-- security-definer functions (the page no longer uses the admin-toggle-user
-- edge function, which never refused your own account).
--
--  * refuse non-admins (42501) and your own account (42501)
--  * only agents and Fulfillment people (admins aren't on the Users page)
--  * refuse a Fulfillment person who is on a call right now (22023)
--  * a person with open clients/calls needs p_confirm (P0001 'has_open_work',
--    the count in DETAIL) so the page can warn first
--  * Fulfillment -> Agent, or a Fulfillment person's access off: their open
--    calls that aren't live go back to the picker (assigned_fulfillment_id
--    null; fulfillment_autoassign picks an active Fulfillment person, so the
--    old one is never picked again). An agent's clients stay theirs.
--  * access off: profiles.is_active false (fulfillment_pick_rep and
--    admin_give_call already skip them), auth ban so sign-in fails, and their
--    sessions end. Back on clears both. Clients and history are untouched.

create or replace function public.admin_open_work(p_user uuid, p_role text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from policies
  where fulfillment_assigned
    and fulfillment_stage is distinct from 'Complete'
    and case when p_role = 'agent' then agent_id = p_user else assigned_fulfillment_id = p_user end;
$$;
revoke all on function public.admin_open_work(uuid, text) from public, anon, authenticated;

create or replace function public.admin_user_guard(p_user uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change access' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t change your own account here' using errcode = '42501';
  end if;
  select role::text into v_role from profiles where id = p_user for update;
  if v_role is null then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  if v_role not in ('agent', 'fulfillment') then
    raise exception 'Only agents and Fulfillment can be changed here' using errcode = '22023';
  end if;
  if v_role = 'fulfillment' and exists (
    select 1 from policies
    where assigned_fulfillment_id = p_user and call_live_since is not null
      and fulfillment_stage is distinct from 'Complete'
  ) then
    raise exception 'They''re on a call right now. Try again after it ends.' using errcode = '22023';
  end if;
  return v_role;
end;
$$;
revoke all on function public.admin_user_guard(uuid) from public, anon, authenticated;

-- Open calls that aren't live go back to the picker.
create or replace function public.admin_release_calls(p_user uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  update policies set assigned_fulfillment_id = null
  where assigned_fulfillment_id = p_user
    and fulfillment_assigned
    and fulfillment_stage is distinct from 'Complete'
    and call_live_since is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.admin_release_calls(uuid) from public, anon, authenticated;

create or replace function public.admin_set_user_role(p_user uuid, p_role text, p_confirm boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cur  text;
  v_open integer;
begin
  v_cur := public.admin_user_guard(p_user);
  if p_role not in ('agent', 'fulfillment') then
    raise exception 'Pick Agent or Fulfillment' using errcode = '22023';
  end if;
  if v_cur = p_role then
    return v_cur;
  end if;
  v_open := public.admin_open_work(p_user, v_cur);
  if v_open > 0 and not coalesce(p_confirm, false) then
    raise exception 'has_open_work' using errcode = 'P0001', detail = v_open::text;
  end if;

  update profiles set role = p_role::user_role where id = p_user;
  if v_cur = 'fulfillment' then
    perform public.admin_release_calls(p_user);
  end if;
  return p_role;
end;
$$;

create or replace function public.admin_set_user_access(p_user uuid, p_active boolean, p_confirm boolean default false)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_open integer;
begin
  if p_active is null then
    raise exception 'Say on or off' using errcode = '22023';
  end if;
  v_role := public.admin_user_guard(p_user);

  if not p_active then
    v_open := case when v_role = 'fulfillment' then public.admin_open_work(p_user, v_role) else 0 end;
    if v_open > 0 and not coalesce(p_confirm, false) then
      raise exception 'has_open_work' using errcode = 'P0001', detail = v_open::text;
    end if;
  end if;

  update profiles set is_active = p_active where id = p_user;
  -- A far-future ban, not 'infinity' (Auth reads it into a Go time).
  update auth.users set banned_until = case when p_active then null else '2999-12-31 00:00:00+00'::timestamptz end
  where id = p_user;

  if not p_active then
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
    if v_role = 'fulfillment' then
      perform public.admin_release_calls(p_user);
    end if;
  end if;
  return p_active;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text, boolean) to authenticated;
revoke all on function public.admin_set_user_access(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_user_access(uuid, boolean, boolean) to authenticated;
