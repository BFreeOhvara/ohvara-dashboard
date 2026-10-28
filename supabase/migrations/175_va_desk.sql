-- 175 — VA desk and call queue on the kept lead model (Roadmap Goal 8).
--
-- RISKY: new RLS insert policies and functions Fulfillment can call. Brayden
-- approves at the door (merge guard).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: columns, one index, functions and two insert policies,
-- each created only if it isn't there yet. Nothing is removed, renamed or
-- emptied. Nothing here calls, texts or writes to anyone: a transfer is only a
-- record (the chosen agent and a status).
--
-- Lead schema read from 166_lead_types_delivery.sql at
-- c66a0ac3d40a3d56d333982d2f5c6e185ec0fd2b (branch 36d240ca, not yet on
-- master). REQUIRES 166 applied first. Do not apply 175 before 166.
-- Also needs master's 173_lead_storage_assignment.sql (it keeps typed leads
-- out of the cancellation rep batch). The check below stops the whole file if
-- either is missing.
--
-- Lead model (Lead Model Decision, Goal 1): one table, public.leads, typed by
-- leads.lead_type. This re-points 170_va_desk.sql (branch 8aa97295, never
-- applied): same roster, save and outcome calls, plus the queue and claims.
-- 173 adds none of the columns below.
--
-- The agent a VA books or transfers to goes in leads.transfer_agent_id only.
-- leads.assigned_rep_id is the agent who received the lead through
-- assign_lead (173) or the cancellation rep batch, so nothing here writes it.
--
--   leads.transfer_agent_id / transfer_status / transferred_at   the transfer
--                         (or booking) record.
--   leads.booking_id      the policies row the VA's booking created.
--   leads.va_claimed_by / va_claim_expires_at   who is working the lead; a
--                         claim lasts 15 minutes and va_claim renews it.
--   leads.va_outcome      the VA's last result: not_reached, callback, booked,
--                         transferred, not_interested.
--   leads.va_callback_at  when a callback is due.
--   leads.va_attempts     how many times a VA has worked the lead.
--   leads.va_checklist    the 4-item qualify checklist (question type,
--                         carrier, state, urgency). qualifier_answers (166)
--                         stays the landing page's answers.
--   leads.va_last_worked_by / va_last_worked_at
--
--   va_agent_roster()          active agents a VA can pick (id + name only).
--   va_queue()                 leads to work: new, not reached, callback due.
--   va_claim(lead)             takes a lead for 15 minutes; one VA at a time.
--   va_release(lead)           gives a claim back.
--   va_save_policy_help_lead() saves an inbound policy-help caller.
--   va_set_lead_outcome()      records the result and ends the claim.
--
-- Every function checks the caller is Fulfillment or admin (both false once
-- access is off; 151, 152) and is callable by signed-in users only.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'qualifier_answers')
     or not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_typed_assigned_only') then
    raise exception '175 needs 166_lead_types_delivery applied first';
  end if;
  if to_regprocedure('public.leads_typed_agents_only()') is null then
    raise exception '175 needs 173_lead_storage_assignment applied first';
  end if;
end $$;

-- ── columns ─────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists transfer_agent_id uuid references public.profiles(id) on delete set null,
  add column if not exists transfer_status text
    check (transfer_status is null or transfer_status in ('requested', 'connected', 'dropped')),
  add column if not exists transferred_at timestamptz,
  add column if not exists booking_id uuid references public.policies(id) on delete set null,
  add column if not exists va_claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists va_claim_expires_at timestamptz,
  add column if not exists va_outcome text
    check (va_outcome is null or va_outcome in ('not_reached', 'callback', 'booked', 'transferred', 'not_interested')),
  add column if not exists va_callback_at timestamptz,
  add column if not exists va_attempts integer not null default 0 check (va_attempts >= 0),
  add column if not exists va_checklist jsonb
    check (va_checklist is null or jsonb_typeof(va_checklist) = 'object'),
  add column if not exists va_last_worked_by uuid references public.profiles(id) on delete set null,
  add column if not exists va_last_worked_at timestamptz;

-- The queue: typed leads with no agent yet.
create index if not exists leads_va_queue_idx
  on public.leads (created_at)
  where lead_type <> 'cancellation' and assigned_rep_id is null;

-- ── Roster ──────────────────────────────────────────────────────────────────
create or replace function public.va_agent_roster()
returns table (id uuid, full_name text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the agent list' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name
      from public.profiles p
     where p.role = 'agent' and p.is_active
     order by p.full_name;
end;
$$;
revoke execute on function public.va_agent_roster() from public, anon;
grant execute on function public.va_agent_roster() to authenticated;

-- ── Queue ───────────────────────────────────────────────────────────────────
-- A typed lead with no agent (assigned_rep_id null) that is new (no VA result
-- yet), not reached, or a callback that is due. A lead another VA holds is
-- left out until their claim expires; an expired claim counts as unclaimed.
-- Order: callbacks due, then new, then not reached; oldest first in each.
create or replace function public.va_queue()
returns table (
  lead_id uuid, lead_type text, lead_source text, contact_name text, phone text,
  city text, state text, qualifier_answers jsonb, va_checklist jsonb,
  bucket text, va_attempts integer, va_callback_at timestamptz,
  claimed_by_me boolean, claim_expires_at timestamptz, created_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the call queue' using errcode = '42501';
  end if;
  return query
    select l.id, l.lead_type, l.lead_source, coalesce(l.contact_name, l.business_name), l.phone,
           l.city, l.state, l.qualifier_answers, l.va_checklist,
           case when l.va_outcome is null then 'new'
                when l.va_outcome = 'not_reached' then 'not_reached'
                else 'callback_due' end,
           l.va_attempts, l.va_callback_at,
           (l.va_claimed_by = v_uid and l.va_claim_expires_at > now()),
           case when l.va_claim_expires_at > now() then l.va_claim_expires_at end,
           l.created_at
      from public.leads l
     where l.lead_type <> 'cancellation'
       and l.assigned_rep_id is null
       and (l.va_outcome is null
            or l.va_outcome = 'not_reached'
            or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
       and (l.va_claimed_by is null
            or l.va_claimed_by = v_uid
            or l.va_claim_expires_at is null
            or l.va_claim_expires_at <= now())
     order by case when l.va_outcome = 'callback' then 0
                   when l.va_outcome is null then 1
                   else 2 end,
              coalesce(l.va_callback_at, l.created_at)
     limit 200;
end;
$$;
revoke execute on function public.va_queue() from public, anon;
grant execute on function public.va_queue() to authenticated;

-- ── Claim ───────────────────────────────────────────────────────────────────
-- One update with the claim test in its WHERE, so two VAs can't both win: the
-- second waits on the row lock, re-checks the WHERE against the first VA's
-- claim and updates nothing. Claiming your own lead again renews it (the desk
-- can call this while the VA is still on the lead). Returns the new expiry.
create or replace function public.va_claim(p_lead uuid)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_until timestamptz;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take a lead' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;

  update public.leads l
     set va_claimed_by = v_uid,
         va_claim_expires_at = now() + interval '15 minutes'
   where l.id = p_lead
     and l.lead_type <> 'cancellation'
     and l.assigned_rep_id is null
     and (l.va_outcome is null
          or l.va_outcome = 'not_reached'
          or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
     and (l.va_claimed_by is null
          or l.va_claimed_by = v_uid
          or l.va_claim_expires_at is null
          or l.va_claim_expires_at <= now())
  returning l.va_claim_expires_at into v_until;

  if v_until is null then
    if not exists (select 1 from public.leads where id = p_lead) then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.leads
                where id = p_lead and va_claimed_by <> v_uid and va_claim_expires_at > now()) then
      raise exception 'Another VA is on this lead' using errcode = '55006';
    end if;
    raise exception 'This lead is not in the queue' using errcode = '22023';
  end if;
  return v_until;
end;
$$;
revoke execute on function public.va_claim(uuid) from public, anon;
grant execute on function public.va_claim(uuid) to authenticated;

-- ── Release ─────────────────────────────────────────────────────────────────
-- Gives your own claim back (admin can free anyone's). Returns false when
-- there was nothing of yours to release.
create or replace function public.va_release(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can release a lead' using errcode = '42501';
  end if;
  update public.leads
     set va_claimed_by = null, va_claim_expires_at = null
   where id = p_lead
     and va_claimed_by is not null
     and (va_claimed_by = auth.uid() or public.is_admin());
  return found;
end;
$$;
revoke execute on function public.va_release(uuid) from public, anon;
grant execute on function public.va_release(uuid) to authenticated;

-- ── Save an inbound caller ──────────────────────────────────────────────────
-- p_outcome: 'saved' (just the lead) or 'transfer' (also records p_agent and
-- transfer_status 'requested'). The lead is left claimed by the VA so they can
-- book it next. A caller whose number already has a typed lead in the last 30
-- days gets that lead (with this checklist), not a second one. Returns the
-- lead id.
create or replace function public.va_save_policy_help_lead(
  p_first text, p_last text, p_phone text, p_city text, p_state text,
  p_answers jsonb, p_outcome text default 'saved', p_agent uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text := btrim(coalesce(p_first, '')) || ' ' || btrim(coalesce(p_last, ''));
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits   text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_state    text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_transfer boolean := p_outcome = 'transfer';
  v_id       uuid;
  v_holder   uuid;
  v_until    timestamptz;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can save a call' using errcode = '42501';
  end if;
  if btrim(coalesce(p_first, '')) = '' or btrim(coalesce(p_last, '')) = '' then
    raise exception 'First and last name are needed' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('saved', 'transfer') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if v_phone is not null and length(v_digits) <> 10 then
    raise exception 'Phone needs 10 digits' using errcode = '22023';
  end if;
  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'State is two letters' using errcode = '22023';
  end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Checklist answers must be an object' using errcode = '22023';
  end if;
  if v_transfer and p_agent is null then
    raise exception 'Pick the agent for the transfer' using errcode = '22023';
  end if;
  if p_agent is not null and not exists (
    select 1 from public.profiles where id = p_agent and role = 'agent' and is_active
  ) then
    raise exception 'That agent is not available' using errcode = '22023';
  end if;

  if v_phone is not null then
    select l.id, l.va_claimed_by, l.va_claim_expires_at into v_id, v_holder, v_until
      from public.leads l
     where l.lead_type <> 'cancellation'
       and l.phone is not null
       and l.created_at >= now() - interval '30 days'
       and right(regexp_replace(l.phone, '\D', '', 'g'), 10) = v_digits
     order by l.created_at desc
     limit 1
     for update;
  end if;

  if v_id is not null then
    if v_holder is not null and v_holder <> v_uid and v_until > now() then
      raise exception 'Another VA is on this caller''s lead' using errcode = '55006';
    end if;
    update public.leads
       set va_checklist = coalesce(p_answers, va_checklist),
           va_claimed_by = v_uid,
           va_claim_expires_at = now() + interval '15 minutes',
           transfer_agent_id = case when v_transfer then p_agent else transfer_agent_id end,
           transfer_status = case when v_transfer then 'requested' else transfer_status end,
           transferred_at = case when v_transfer then now() else transferred_at end,
           va_outcome = case when v_transfer then 'transferred' else va_outcome end,
           va_attempts = va_attempts + case when v_transfer then 1 else 0 end,
           va_last_worked_by = v_uid,
           va_last_worked_at = now()
     where id = v_id;
    return v_id;
  end if;

  insert into public.leads (
    business_name, contact_name, phone, city, state,
    lead_type, lead_source, va_checklist,
    va_claimed_by, va_claim_expires_at,
    transfer_agent_id, transfer_status, transferred_at,
    va_outcome, va_attempts, va_last_worked_by, va_last_worked_at
  ) values (
    v_name, v_name, v_phone, nullif(btrim(coalesce(p_city, '')), ''), v_state,
    'policy_help', 'google', p_answers,
    v_uid, now() + interval '15 minutes',
    case when v_transfer then p_agent end,
    case when v_transfer then 'requested' end,
    case when v_transfer then now() end,
    case when v_transfer then 'transferred' end,
    case when v_transfer then 1 else 0 end,
    v_uid, now()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.va_save_policy_help_lead(text, text, text, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.va_save_policy_help_lead(text, text, text, text, text, jsonb, text, uuid) to authenticated;

-- ── Record the result ───────────────────────────────────────────────────────
-- Needs the caller's live claim (admin needs none) and ends it. p_outcome:
--   not_reached     back in the queue as not reached
--   callback        back in the queue when p_callback_at comes (within 90 days)
--   booked          p_agent required; p_booking_id is the policies row the
--                   booking made for that agent (optional)
--   transferred     p_agent required; transfer_status 'requested'
--   not_interested  off the queue
-- p_outcome defaults to 'booked' so 170's call (p_lead, p_agent) still works.
create or replace function public.va_set_lead_outcome(
  p_lead uuid, p_agent uuid default null, p_outcome text default 'booked',
  p_callback_at timestamptz default null, p_booking_id uuid default null,
  p_checklist jsonb default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can update a call' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if p_outcome is null or p_outcome not in ('not_reached', 'callback', 'booked', 'transferred', 'not_interested') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if p_outcome = 'callback' and (p_callback_at is null or p_callback_at <= now()
                                 or p_callback_at > now() + interval '90 days') then
    raise exception 'Pick a callback time in the next 90 days' using errcode = '22023';
  end if;
  if p_outcome in ('booked', 'transferred') then
    if p_agent is null then
      raise exception 'Pick the agent' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles where id = p_agent and role = 'agent' and is_active) then
      raise exception 'That agent is not available' using errcode = '22023';
    end if;
  end if;
  if p_booking_id is not null and (p_outcome <> 'booked' or not exists (
    select 1 from public.policies where id = p_booking_id and agent_id = p_agent
  )) then
    raise exception 'That booking is not on the agent''s calendar' using errcode = '22023';
  end if;
  if p_checklist is not null and jsonb_typeof(p_checklist) <> 'object' then
    raise exception 'Checklist answers must be an object' using errcode = '22023';
  end if;

  update public.leads
     set va_outcome = p_outcome,
         va_callback_at = case when p_outcome = 'callback' then p_callback_at end,
         va_attempts = va_attempts + 1,
         va_checklist = coalesce(p_checklist, va_checklist),
         transfer_agent_id = case when p_outcome in ('booked', 'transferred') then p_agent else transfer_agent_id end,
         transfer_status = case when p_outcome = 'transferred' then 'requested' else transfer_status end,
         transferred_at = case when p_outcome = 'transferred' then now() else transferred_at end,
         booking_id = case when p_outcome = 'booked' then coalesce(p_booking_id, booking_id) else booking_id end,
         va_last_worked_by = v_uid,
         va_last_worked_at = now(),
         va_claimed_by = null,
         va_claim_expires_at = null
   where id = p_lead
     and lead_type <> 'cancellation'
     and ((va_claimed_by = v_uid and va_claim_expires_at > now()) or public.is_admin());

  if not found then
    if not exists (select 1 from public.leads where id = p_lead and lead_type <> 'cancellation') then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Take the lead first (a claim lasts 15 minutes)' using errcode = '55006';
  end if;
end;
$$;
revoke execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) to authenticated;

-- ── Booking for an agent ────────────────────────────────────────────────────
-- policies_insert (149) is agent_id = auth.uid(). A VA may also insert a row
-- for an active agent; the row is the same one useBookCall always writes.
-- Same two policies as 170.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'policies' and policyname = 'policies_insert_va') then
    create policy policies_insert_va on public.policies
      for insert to authenticated
      with check (
        public.is_fulfillment()
        and exists (select 1 from public.profiles a where a.id = policies.agent_id and a.role = 'agent' and a.is_active)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'policy_fulfillment_details' and policyname = 'fulfillment_details_insert_va') then
    create policy fulfillment_details_insert_va on public.policy_fulfillment_details
      for insert to authenticated
      with check (
        public.is_fulfillment()
        and exists (select 1 from public.policies p where p.id = policy_fulfillment_details.policy_id and p.fulfillment_assigned)
      );
  end if;
end $$;

-- Check after applying (expect authenticated true, anon false for each):
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
--          has_function_privilege('authenticated', p.oid, 'execute') authed
--     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%';
