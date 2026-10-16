-- 149 — Fulfillment hardening, area 2: what a rep can change (Prompt 769-2).
--
-- Before this, fulfillment_update_assigned let any Fulfillment rep UPDATE any
-- column of any call handed to Fulfillment: mark another rep's call
-- Cancelled, move a call to themselves, change the client, the agent or the
-- booked time. Now a rep has no direct UPDATE on policies at all. Every rep
-- change goes through a security-definer RPC that checks the call is theirs:
-- fulfillment_start_call / end_call / correct_result / set_reschedule_reason /
-- pass_on (unchanged), and the two below, which replace the portal's last
-- direct writes (Mark cancelled and the call notes). A rep clicking normally
-- sees no change.

drop policy if exists fulfillment_update_assigned on public.policies;

-- Booking a call is for agents (and admin). A rep could insert a "booking"
-- under their own id, which the auto-assign could hand straight back to them.
drop policy if exists policies_insert on public.policies;
create policy policies_insert on public.policies
  for insert with check (agent_id = auth.uid() and public.is_team_member());

-- ── Mark cancelled ──────────────────────────────────────────────────────────
-- The same write the portal made directly: stage Complete, status In Effect.
-- p_set_notes: save p_notes as the call notes (blank clears them).
-- p_proof: save the confirmation number, effective date and drafts-stopped
-- from the phone's result screen. The cancel row (and its pay) is still made
-- by fulfillment_cancel_on_result, on the server, at the configured rate.
create or replace function public.fulfillment_mark_cancelled(
  p_policy uuid,
  p_notes text default null,
  p_set_notes boolean default false,
  p_proof boolean default false,
  p_confirmation text default null,
  p_effective date default null,
  p_drafts_stopped boolean default false
) returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  pol policies;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if pol.assigned_fulfillment_id is distinct from auth.uid() or not public.is_fulfillment() then
    raise exception 'Only the rep it''s assigned to can mark this cancelled' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;

  update policies
     set fulfillment_stage           = 'Complete',
         status                      = 'In Effect',
         cancellation_notes          = case when p_set_notes then nullif(btrim(p_notes), '') else cancellation_notes end,
         cancellation_confirmation   = case when p_proof then nullif(btrim(p_confirmation), '') else cancellation_confirmation end,
         cancellation_effective_date = case when p_proof then p_effective else cancellation_effective_date end,
         drafts_stopped              = case when p_proof then coalesce(p_drafts_stopped, false) else drafts_stopped end
   where id = p_policy;
end;
$$;

-- ── Call notes ──────────────────────────────────────────────────────────────
create or replace function public.fulfillment_save_notes(p_policy uuid, p_notes text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  pol policies;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if pol.assigned_fulfillment_id is distinct from auth.uid() or not public.is_fulfillment() then
    raise exception 'Only the rep it''s assigned to can change the notes' using errcode = '42501';
  end if;
  update policies set cancellation_notes = nullif(btrim(p_notes), '') where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_mark_cancelled(uuid, text, boolean, boolean, text, date, boolean) from public, anon;
revoke all on function public.fulfillment_save_notes(uuid, text) from public, anon;
grant execute on function public.fulfillment_mark_cancelled(uuid, text, boolean, boolean, text, date, boolean) to authenticated;
grant execute on function public.fulfillment_save_notes(uuid, text) to authenticated;
