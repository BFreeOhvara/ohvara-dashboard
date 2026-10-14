-- Prompt 760 — Admin Fulfillment's "Give to": an admin moves a call that is
-- stuck or not started yet to a Fulfillment person they pick. The only change
-- admin makes on that page (P759 made admin view-only on client status).
--
--  * admin only; refuses a live call and a finished (cancelled) one
--  * the new person must be an active Fulfillment rep, not the current one
--  * no double-booking: refused when the new person already has an open call
--    within one slot (30 min) of this call's time
--  * logs a policy_events row (kind 'reassigned', from/to in detail)
--  * the new person is told by fulfillment_assigned_notify (the assign
--    trigger); the old person gets a notification here.

alter table public.policy_events drop constraint policy_events_kind_check;
alter table public.policy_events add constraint policy_events_kind_check
  check (kind = any (array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned']));

create or replace function public.admin_give_call(p_policy uuid, p_to uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
    from profiles where id = p_to and role = 'fulfillment' and is_active;
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

revoke all on function public.admin_give_call(uuid, uuid) from public, anon;
grant execute on function public.admin_give_call(uuid, uuid) to authenticated;
