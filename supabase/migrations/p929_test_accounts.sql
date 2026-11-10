-- P929 — the test accounts are a sandbox (Brayden, Nov 9 22:00).
-- Keep the test agent, the test VA and the App Review agent and VA for checking things later. They are marked
-- profiles.is_test, and a test account always lives on the demo side (migration 156's sandbox):
--   * profiles.is_test: new column; nobody signed in can change it (admins included), like is_demo.
--   * is_test => is_demo, so the 156 wall applies: never billed, never texts clients, no caller ID, their bookings
--     and submits only go to demo-side VAs (fulfillment_pick_rep, servicing_va_pick, the servicing queue), and their
--     policies sit behind policies_demo_wall. The test agent's existing policies move to the demo side.
--   * Lead routing: assign_lead skips test agents.
--   * The call engine has two sides: a test agent's lead is only offered to test VAs, every other call only to real
--     ones (route_offer via route_can_take(p, at, test)). The lead desk (va_queue / va_claim) is split the same way.
--   * The AI caller (Retell) never calls a test agent's lead; GoHighLevel gets nothing for them (outbox triggers).
--   * VA pods: a test VA can't be put on a Deedstone number.
-- Admin numbers leave test accounts out in the app (src/lib/admReal.js).

-- 1. The flag ---------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists is_test boolean not null default false;
comment on column public.profiles.is_test is
  'P929: a test account (test agent, test VA, App Review logins). Always on the demo side; left out of admin numbers, lead routing, VA pods, Retell, GoHighLevel, Twilio and Stripe.';

create or replace function public.profiles_test_side()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon')
     and new.is_test is distinct from old.is_test then
    raise exception 'That part of a profile can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and current_user in ('authenticated', 'anon') and new.is_test then
    raise exception 'That part of a profile can''t be changed' using errcode = '42501';
  end if;
  if new.is_test then new.is_demo := true; end if;   -- fires before profiles_demo_locks (name order)
  return new;
end;
$$;
drop trigger if exists profiles_0_test_side on public.profiles;
create trigger profiles_0_test_side before insert or update on public.profiles
  for each row execute function public.profiles_test_side();

update public.profiles set is_test = true
 where id in ('3f2b2df7-40b1-4921-80e2-09981c819642',   -- Test Agent (nate44)
              '402a7a07-c9b0-428f-9b9d-ff2b6480bed0',   -- Test Fulfill (the test VA)
              'c76e4ab2-256d-422c-87dc-0f27ce882981',   -- Avery Demo (App Review agent)
              'aa149f56-3f13-4ee9-9fd1-e3bcc6082b7d')   -- Riley Demo (App Review VA)
   and not is_test;

-- The test agent's policies join the sandbox (a real VA on one is cleared by policies_demo_guard).
update public.policies set is_demo = true
 where not is_demo and agent_id in (select id from public.profiles where is_test);

create or replace function public.profile_is_test(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_test from public.profiles where id = p_id), false)
$$;
create or replace function public.my_is_test()
returns boolean language sql stable security definer set search_path = public as $$
  select public.profile_is_test(auth.uid())
$$;
-- A lead is on the test side when its agent is a test account.
create or replace function public.lead_is_test(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select pr.is_test from public.leads l join public.profiles pr on pr.id = l.assigned_rep_id
                    where l.id = p_lead), false)
$$;
revoke execute on function public.profile_is_test(uuid), public.lead_is_test(uuid) from public, anon;
grant execute on function public.my_is_test() to authenticated;

-- 2. Lead routing: never to a test agent ----------------------------------------------------------------------------
create or replace function public.assign_lead(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lead      record;
  v_state     text;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Chicago')) at time zone 'America/Chicago';
  v_agent     uuid;
begin
  if p_lead_id is null then
    raise exception 'lead_id is required' using errcode = '22004';
  end if;

  select id, state, lead_type, assigned_rep_id into v_lead
    from leads where id = p_lead_id
    for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'Lead % is a cancellation lead', p_lead_id using errcode = '22023';
  end if;
  if v_lead.assigned_rep_id is not null then
    return v_lead.assigned_rep_id;
  end if;

  v_state := upper(btrim(v_lead.state));
  if v_state is null or v_state = '' then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assign_lead', 0));

  select s.agent_id into v_agent
    from agent_lead_settings s
    join profiles p on p.id = s.agent_id and p.role = 'agent' and p.is_active
                   and not coalesce(p.is_test, false)                     -- P929: never a test account
    cross join lateral (
      select count(*) filter (where l.delivered_at >= v_day_start) as today,
             max(l.delivered_at) as last_at
        from leads l
       where l.assigned_rep_id = s.agent_id
         and l.lead_type <> 'cancellation'
         and l.delivered_at is not null
    ) c
   where s.active
     and v_state = any (s.states)
     and public.licence_allows(s.agent_id, v_state)          -- P881: verified states only
     and (s.daily_cap is null or c.today < s.daily_cap)
   order by c.today, c.last_at asc nulls first, s.agent_id
   limit 1;

  if v_agent is null then
    return null;
  end if;

  update leads
     set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
   where id = p_lead_id and assigned_rep_id is null;

  return v_agent;
end;
$$;

-- 3. The call engine: two sides ------------------------------------------------------------------------------------
-- p_test true: only test VAs (the sandbox). false: only real, non-demo VAs (as before).
create or replace function public.route_can_take(p va_presence, p_at timestamptz, p_test boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select p.last_seen > p_at - interval '30 seconds'
     and exists (select 1 from public.profiles pr where pr.id = p.user_id and coalesce(pr.is_active, true)
                   and case when p_test then coalesce(pr.is_test, false) else not coalesce(pr.is_demo, false) end
                   and ((pr.role::text = 'admin' and p.is_desk)
                        or (pr.role::text = 'fulfillment' and public.va_on_shift_at(p.user_id, p_at))))
$$;
revoke execute on function public.route_can_take(va_presence, timestamptz, boolean) from public, anon;

-- A queued call is on the test side when its lead's agent, or its policy's agent, is a test account.
create or replace function public.call_queue_is_test(q public.call_queue)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.lead_is_test(q.lead_id), false)
      or coalesce((select pr.is_test from public.policies po join public.profiles pr on pr.id = po.agent_id
                    where po.id = q.policy_id), false)
$$;
revoke execute on function public.call_queue_is_test(public.call_queue) from public, anon;

create or replace function public.route_offer(p_item uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare q public.call_queue; who uuid; pull boolean := false; pick uuid; t boolean;
begin
  select * into q from public.call_queue where id = p_item and status = 'waiting' for update skip locked;
  if q.id is null then return null; end if;
  t := public.call_queue_is_test(q);                       -- P929: test calls only ring test VAs, and the reverse
  if q.kind = 'callback' and q.promiser_id is not null and not (q.promiser_id = any(q.missed_by || q.exclude)) then
    select p.user_id into who from public.va_presence p
     where p.user_id = q.promiser_id and p.status = 'available' and public.route_can_take(p, now(), t);
  end if;
  if who is null and q.kind = 'inbound' and jsonb_typeof(q.detail -> 'prefer') = 'array' then
    for pick in select (e.v #>> '{}')::uuid from jsonb_array_elements(q.detail -> 'prefer') with ordinality e(v, n) order by e.n loop
      select p.user_id into who from public.va_presence p
       where p.user_id = pick and p.status = 'available' and public.route_can_take(p, now(), t)
         and not (p.user_id = any(q.missed_by || q.exclude))
       for update skip locked;
      exit when who is not null;
    end loop;
  end if;
  if who is null then
    select p.user_id into who from public.va_presence p
     where p.status = 'available' and public.route_can_take(p, now(), t)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.idle_since asc nulls last, p.user_id
     limit 1 for update skip locked;
  end if;
  if who is null and q.kind in ('new_lead', 'inbound') then
    select p.user_id into who from public.va_presence p
     where p.status = 'on_hold_carrier' and public.route_can_take(p, now(), t)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.since asc, p.user_id
     limit 1 for update skip locked;
    pull := who is not null;
  end if;
  if who is null then return null; end if;

  update public.call_queue
     set status = 'offered', offered_to = who, offered_at = now(), offer_expires_at = now() + interval '15 seconds',
         pull_hold = pull
   where id = q.id;
  update public.va_presence set status = case when pull then status else 'ringing' end, updated_at = now()
   where user_id = who;
  begin
    perform public.notify(who, 'va_ring',
      case q.kind when 'inbound' then 'Someone is calling in' when 'new_lead' then 'New lead: call now'
                  when 'callback' then 'Callback due now' when 'hold_handoff' then 'A carrier hold was handed to you'
                  else 'A dropped call needs you' end,
      coalesce(q.name, 'Answer in the portal'), '/fulfillment', true, 'ring:' || q.id::text,
      jsonb_build_object('queue_id', q.id, 'kind', q.kind));
  exception when others then raise warning 'va_ring notify: %', sqlerrm;
  end;
  return who;
end;
$$;

-- 4. The lead desk: a test VA sees only test agents' leads; everyone else never sees them ---------------------------
create or replace function public.va_queue()
returns table(lead_id uuid, lead_type text, lead_source text, contact_name text, phone text, city text, state text,
              qualifier_answers jsonb, va_checklist jsonb, bucket text, va_attempts integer,
              va_callback_at timestamptz, claimed_by_me boolean, claim_expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_test boolean := public.my_is_test();
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
       and public.lead_is_test(l.id) = v_test
       and case when l.lead_type = 'mortgage_protection'
                 and l.va_outcome is distinct from 'callback'
                 and exists (select 1 from public.inbound_events e
                              where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step')
                then exists (select 1 from public.inbound_events e
                              where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                                and e.at <= now())
                else l.assigned_rep_id is null
                     and (l.va_outcome is null
                          or l.va_outcome = 'not_reached'
                          or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
           end
       and (l.va_claimed_by is null
            or l.va_claimed_by = v_uid
            or l.va_claim_expires_at is null
            or l.va_claim_expires_at <= now())
     order by case when l.lead_type = 'mortgage_protection'
                    and exists (select 1 from public.inbound_events e
                                 where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                                   and e.detail ->> 'va_step' = 'rebook' and e.at <= now())
                   then 0 else 1 end,
              case when l.va_outcome = 'callback' then 0
                   when l.va_outcome is null then 1
                   else 2 end,
              coalesce(l.va_callback_at, l.created_at)
     limit 200;
end;
$$;

create or replace function public.va_claim(p_lead uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
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
  -- P929: the test side and the real side never take each other's leads
  if public.lead_is_test(p_lead) is distinct from public.my_is_test() then
    raise exception 'This lead is not in the queue' using errcode = '22023';
  end if;

  update public.leads l
     set va_claimed_by = v_uid,
         va_claim_expires_at = now() + interval '15 minutes'
   where l.id = p_lead
     and l.lead_type <> 'cancellation'
     and (case when l.lead_type = 'mortgage_protection'
                and l.va_outcome is distinct from 'callback'
                and exists (select 1 from public.inbound_events e
                             where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step')
               then exists (select 1 from public.inbound_events e
                             where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                               and e.at <= now())
               else l.assigned_rep_id is null
                    and (l.va_outcome is null
                         or l.va_outcome = 'not_reached'
                         or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
          end
          or public.lead_transfer_missed(l.id))
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

-- 5. Retell: the AI caller never calls a test agent's lead -----------------------------------------------------------
create or replace function public.ai_caller_takes(p_lead uuid)
returns table(by text, reason text) language plpgsql stable security definer set search_path = public as $$
declare l public.leads; s public.ai_caller_settings; chk record;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.lead_type is distinct from 'mortgage_protection' or l.phone is null
     or coalesce(l.qualifier_answers ->> 'consent_at', '') = '' or l.call_consent_at is not null then
    return query select 'va', 'not_form'; return;               -- inbound calls and anything not a fresh form lead
  end if;
  if public.profile_is_test(l.assigned_rep_id) then
    return query select 'va', 'test_account'; return;           -- P929: the sandbox never reaches Retell
  end if;
  if not coalesce((select ai_caller_live from public.recovery_config limit 1), false) then
    return query select 'va', 'switch_off'; return;
  end if;
  select * into s from public.ai_caller_settings where id;
  if l.assigned_rep_id is null or not (s.all_agents or l.assigned_rep_id = any(s.agent_ids)) then
    return query select 'va', 'agent_not_on'; return;
  end if;
  if not public.lead_ai_consent_ok(p_lead) then return query select 'va', 'no_ai_consent'; return; end if;
  select * into chk from public.predial_eval(l.phone, l.state, l.id, 'call', now(), null, false);
  if not chk.ok then return query select 'va', coalesce(chk.reason, 'predial'); return; end if;
  return query select 'ai', null::text;
end;
$$;

-- 6. GoHighLevel: nothing goes out for a test agent's lead -------------------------------------------------------------
create or replace function public.ghl_enqueue_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inbound_stage is null or coalesce(new.is_sample, false) or not public.ghl_enabled()
     or public.profile_is_test(new.assigned_rep_id) then        -- P929
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into ghl_outbox (event, lead_id, stage) values ('new_inbound', new.id, new.inbound_stage);
  elsif new.inbound_stage is distinct from old.inbound_stage then
    insert into ghl_outbox (event, lead_id, stage)
    values (case when new.inbound_stage = 'booked' then 'appointment_reminder' else 'stage' end,
            new.id, new.inbound_stage);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_lead: %', sqlerrm;   -- never block the lead write
  return new;
end;
$$;

create or replace function public.ghl_enqueue_no_show()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'no_show' and new.state = 'done' and not coalesce(new.is_sample, false)
     and public.ghl_enabled() and not public.lead_is_test(new.lead_id) then   -- P929
    insert into ghl_outbox (event, lead_id) values ('no_show', new.lead_id);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_no_show: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.lead_ghl_event(p_event text, p_lead uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ghl_enabled() or public.lead_is_test(p_lead)                  -- P929
     or exists (select 1 from public.leads where id = p_lead and coalesce(is_sample, false)) then return; end if;
  insert into public.ghl_outbox (event, lead_id, detail) values (p_event, p_lead, coalesce(p_detail, '{}'::jsonb));
exception when others then raise warning 'lead_ghl_event %: %', p_event, sqlerrm;
end;
$$;

-- 7. VA pods: real VAs only --------------------------------------------------------------------------------------------
create or replace function public.admin_set_number_pod(p_number uuid, p_vas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := coalesce(array_length(p_vas, 1), 0); i int;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if n < 2 or n > 3 then raise exception 'A number needs 2 or 3 VAs' using errcode = '22023'; end if;
  if (select count(distinct v) from unnest(p_vas) v) <> n then raise exception 'A VA is listed twice' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_vas) v where not exists (select 1 from profiles p where p.id = v and p.role = 'fulfillment')) then
    raise exception 'Only VAs can be on a number' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_vas) v join profiles p on p.id = v where p.is_test or p.is_demo) then   -- P929
    raise exception 'Test accounts can''t be on a number' using errcode = '22023';
  end if;
  if not exists (select 1 from deedstone_numbers where id = p_number) then raise exception 'Number not found' using errcode = 'P0002'; end if;
  delete from deedstone_number_vas where number_id = p_number;
  for i in 1..n loop
    insert into deedstone_number_vas (number_id, va_id, sort) values (p_number, p_vas[i], i);
  end loop;
  return jsonb_build_object('ok', true, 'vas', to_jsonb(p_vas));
end; $$;
-- A test VA already on a pod comes off it.
delete from public.deedstone_number_vas where va_id in (select id from public.profiles where is_test or is_demo);

-- P922 locked doors: nobody signed out runs any of these, and nobody calls the trigger function.
revoke execute on function public.profiles_test_side() from public, anon, authenticated;
revoke execute on function public.my_is_test() from public, anon;
grant execute on function public.my_is_test() to authenticated;
