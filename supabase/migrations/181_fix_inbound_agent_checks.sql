-- 181 — set_inbound_outcome and add_inbound_note: an unassigned lead no
-- longer lets any active agent through. Fixes 180 l.466 and l.546.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Needs 180_agent_inbounds applied first.
--
-- Why: both functions check the caller with
--   if not found or not (public.is_admin() or (v_lead.assigned_rep_id = v_uid and exists (...)))
-- When leads.assigned_rep_id is null and the caller is an active non-admin,
-- the inner expression is null, `not null` is null, and the IF never raises.
-- So any active agent could set follow_up / not_interested on, or add a note
-- to, an unassigned inbound (sold was already blocked by 180 l.477).
--
-- The fix: the check is wrapped in coalesce(..., false), so null counts as
-- "not allowed" and the IF raises 42501. Admins and an active assigned agent
-- pass as before; an inactive or other agent is refused as before. Each
-- function is copied from 180 character for character (same signature,
-- security definer, search_path and body) with only its IF line changed, and
-- 180's grant/revoke lines are repeated. Nothing else changes.

create or replace function public.set_inbound_outcome(p_lead uuid, p_outcome text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_lead  record;
  v_stage text;
  v_name  text;
  v_role  text;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if p_outcome is null or p_outcome not in ('sold', 'follow_up', 'not_interested') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters' using errcode = '22023';
  end if;

  select id, lead_type, assigned_rep_id, inbound_stage, client_policy_id into v_lead
    from leads where id = p_lead
    for update;
  if not found or not coalesce((
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ), false) then
    if not found and public.is_admin() then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'This is not an inbound lead' using errcode = '22023';
  end if;
  if p_outcome = 'sold' and v_lead.assigned_rep_id is null then
    raise exception 'Give the lead to an agent before marking it sold' using errcode = '22023';
  end if;

  v_stage := case p_outcome when 'sold' then 'sold' when 'follow_up' then 'follow_up' else 'lost' end;

  update leads
     set outcome = p_outcome, outcome_at = now(), outcome_by = v_uid, inbound_stage = v_stage
   where id = p_lead;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'outcome',
          case p_outcome when 'sold' then 'Sold' when 'follow_up' then 'Follow up' else 'Not interested' end,
          jsonb_build_object('outcome', p_outcome, 'from_stage', v_lead.inbound_stage)
            || case when v_note is not null then jsonb_build_object('note', v_note) else '{}'::jsonb end,
          v_uid, v_name, v_role);

  if p_outcome = 'sold' then
    insert into servicing_tasks (agent_id, lead_id, policy_id, kind, status, due_at, requested_by)
    values (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'packet_check',     'scheduled', now() + interval '7 days',   v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'review_call',      'scheduled', now() + interval '30 days',  v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'chargeback_watch', 'scheduled', now() + interval '12 months', v_uid)
    on conflict do nothing;

    insert into inbound_events (lead_id, agent_id, kind, label, actor_id, actor_name, actor_role)
    values (p_lead, v_lead.assigned_rep_id, 'became_client', 'Became a client', v_uid, v_name, v_role)
    on conflict do nothing;
  end if;

  return v_stage;
end;
$$;

revoke execute on function public.set_inbound_outcome(uuid, text, text) from public, anon;
grant execute on function public.set_inbound_outcome(uuid, text, text) to authenticated;

create or replace function public.add_inbound_note(p_lead uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_lead record;
  v_name text;
  v_role text;
  v_id   uuid;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if v_note is null then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters' using errcode = '22023';
  end if;

  select id, lead_type, assigned_rep_id into v_lead from leads where id = p_lead;
  if not found or not coalesce((
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ), false) then
    if not found and public.is_admin() then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'This is not an inbound lead' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'note', 'Note', jsonb_build_object('note', v_note),
          v_uid, v_name, v_role)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_inbound_note(uuid, text) from public, anon;
grant execute on function public.add_inbound_note(uuid, text) to authenticated;
