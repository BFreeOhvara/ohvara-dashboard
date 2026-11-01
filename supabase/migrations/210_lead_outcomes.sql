-- 210 — Lead outcomes: Sold only records, Follow up takes a date, Not interested
-- takes a reason, and a follow-up comes due for the agent in the app.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. It applies
-- only after 193_servicing_model.sql: its first statement stops the whole file if 193
-- isn't there. Additive to data: one new nullable column. Two functions are dropped and
-- created again, and nothing in the database depends on either.
--
-- APPLY WITH THE NEW LEADS PAGE. The page that ships today (InboundDetail.jsx, through
-- useInbounds.js:179) sends no date and no reason. Once this is applied its Follow up and
-- Not interested buttons are refused and show "Couldn't save". Its Sold button keeps
-- working, but its words still say Sold starts servicing. The leads-page-ui task changes
-- both.
--
-- Why: spec section 5 and R3. Sold only records the outcome. 193's Sold also seeded three
-- servicing steps and wrote a "became a client" event. Servicing starts from Submit
-- (195), not from here. Rows those old calls already wrote stay as they are.
--
-- set_inbound_outcome is copied from 193, its newest version, with only these changes:
--   two trailing arguments            p_follow_up_at, p_reason, both default null. The
--                                     old call with three arguments resolves through the
--                                     defaults. Dropped first, so there is no overload.
--   Follow up and Not interested      refused without a date in the future, or without
--                                     a reason of 1 to 500 characters (22023). Checked
--                                     after the caller check, so a stranger only ever
--                                     hears "Only the lead's agent can do this".
--   each outcome replaces the last    follow_up_at holds a date only while the outcome is
--                                     follow_up, outcome_reason a reason only while it is
--                                     not_interested. The event log keeps the old values.
--   the one outcome event             detail gets follow_up_at or reason. There's still
--                                     one event per call, kind 'outcome'; the feed reads
--                                     that kind and doesn't read these two keys.
--   Sold's seeds and its second event removed. client_policy_id isn't read any more.
-- 193 has no demo branch to keep, and this file doesn't add one: a demo agent's lead and
-- a lead with is_sample take an outcome like any other, as they did.
--
-- leads.follow_up_at is not new. It has been there since 017, for the cancellation
-- pipeline, so the add below does nothing on a real database. The two uses don't meet:
-- handle_lead_pipeline only acts on it when leads.status is 'Follow-Up' or 'No Answer',
-- this function never sets status, and the cold-lead jobs filter on lead_type (180).
--
-- agent_inbounds is copied from 180, its only version, with three columns added at the
-- end. A return type can't be changed in place, so it's dropped first.
--
-- The reminder is the agent's own and in the app: follow_up_due turns true at
-- follow_up_at. Nothing here sends anything to a lead or adds a job.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   rpc set_inbound_outcome(p_lead, p_outcome, p_note default null,
--                           p_follow_up_at default null, p_reason default null)
--     Returns the new inbound_stage. 22023 messages:
--       'Pick a follow up date'                  follow_up with no date
--       'Pick a follow up date in the future'    follow_up with a date not after now
--       'Say why they are not interested'        not_interested with no reason, or spaces
--       'Keep the reason to 500 characters'      over 500 after trimming
--   rpc agent_inbounds(), three more columns
--     follow_up_at, outcome_reason, follow_up_due (never null; true when the outcome is
--     follow_up and follow_up_at <= now()).

do $$
begin
  if to_regclass('public.agent_clients') is null
     or to_regprocedure('public.agent_inbounds()') is null then
    raise exception '210 needs 180_agent_inbounds and 193_servicing_model applied first';
  end if;
end $$;

-- ── 1. leads ────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists follow_up_at timestamptz,
  add column if not exists outcome_reason text check (length(outcome_reason) <= 500);

comment on column public.leads.outcome_reason is
  'Why the agent marked the lead not interested. Only set_inbound_outcome writes it.';

-- ── 2. set_inbound_outcome ──────────────────────────────────────────────────
drop function public.set_inbound_outcome(uuid, text, text);

create function public.set_inbound_outcome(
  p_lead         uuid,
  p_outcome      text,
  p_note         text default null,
  p_follow_up_at timestamptz default null,
  p_reason       text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r\f\v'), '');
  v_lead   record;
  v_stage  text;
  v_name   text;
  v_role   text;
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

  select id, lead_type, assigned_rep_id, inbound_stage into v_lead
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
  if p_outcome = 'follow_up' then
    if p_follow_up_at is null then
      raise exception 'Pick a follow up date' using errcode = '22023';
    end if;
    if p_follow_up_at <= now() then
      raise exception 'Pick a follow up date in the future' using errcode = '22023';
    end if;
  end if;
  if p_outcome = 'not_interested' then
    if v_reason is null then
      raise exception 'Say why they are not interested' using errcode = '22023';
    end if;
    if length(v_reason) > 500 then
      raise exception 'Keep the reason to 500 characters' using errcode = '22023';
    end if;
  end if;

  v_stage := case p_outcome when 'sold' then 'sold' when 'follow_up' then 'follow_up' else 'lost' end;

  update leads
     set outcome = p_outcome, outcome_at = now(), outcome_by = v_uid, inbound_stage = v_stage,
         follow_up_at = case when p_outcome = 'follow_up' then p_follow_up_at end,
         outcome_reason = case when p_outcome = 'not_interested' then v_reason end
   where id = p_lead;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'outcome',
          case p_outcome when 'sold' then 'Sold' when 'follow_up' then 'Follow up' else 'Not interested' end,
          jsonb_build_object('outcome', p_outcome, 'from_stage', v_lead.inbound_stage)
            || case when v_note is not null then jsonb_build_object('note', v_note) else '{}'::jsonb end
            || case p_outcome
                 when 'follow_up' then jsonb_build_object('follow_up_at', p_follow_up_at)
                 when 'not_interested' then jsonb_build_object('reason', v_reason)
                 else '{}'::jsonb
               end,
          v_uid, v_name, v_role);

  return v_stage;
end;
$$;

revoke all on function public.set_inbound_outcome(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function public.set_inbound_outcome(uuid, text, text, timestamptz, text) to authenticated;

-- ── 3. agent_inbounds ───────────────────────────────────────────────────────
drop function public.agent_inbounds();

create function public.agent_inbounds()
returns table (
  lead_id uuid, lead_type text, inbound_product text, inbound_stage text,
  outcome text, outcome_at timestamptz, live_call_result text,
  contact_name text, phone text, city text, state text, lead_source text,
  qualifier_answers jsonb, transfer_status text, transferred_at timestamptz,
  va_outcome text, booking_id uuid, client_policy_id uuid,
  delivered_at timestamptz, created_at timestamptz,
  follow_up_at timestamptz, outcome_reason text, follow_up_due boolean
)
language sql
stable security invoker
set search_path = public
as $$
  select l.id, l.lead_type, l.inbound_product, l.inbound_stage,
         l.outcome, l.outcome_at,
         case
           when l.inbound_product is distinct from 'live_call' then null
           when l.transfer_status in ('requested', 'connected') then 'transferred'
           when l.va_outcome = 'booked' then 'booked'
           when l.transfer_status = 'dropped' or l.va_outcome = 'not_reached' then 'missed'
         end,
         coalesce(l.contact_name, l.business_name), l.phone, l.city, l.state, l.lead_source,
         l.qualifier_answers, l.transfer_status, l.transferred_at,
         l.va_outcome, l.booking_id, l.client_policy_id,
         l.delivered_at, l.created_at,
         l.follow_up_at, l.outcome_reason,
         coalesce(l.outcome = 'follow_up' and l.follow_up_at <= now(), false)
    from public.leads l
   where l.assigned_rep_id = auth.uid()
     and l.lead_type <> 'cancellation'
   order by coalesce(l.delivered_at, l.created_at) desc;
$$;

revoke all on function public.agent_inbounds() from public, anon;
grant execute on function public.agent_inbounds() to authenticated;
