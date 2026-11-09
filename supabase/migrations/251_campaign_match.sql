-- P913 — match every lead to its agent two ways: the agent ID in the ad link, or the Meta campaign ID (one campaign
-- per agent). Written, NOT applied (unnumbered; the backend prompt numbers and applies it). Builds on 232.
--   1. lead_intake.routing gains 'campaign' (matched by the campaign ID because the link had no usable agent ID).
--   2. ghl_save_campaign: GoHighLevel's "campaign created" callback saves the campaign ID on the agent
--      (ghl_campaign_agents, one per agent and lead type). Jordan's hand-off: the engine must send it back.
--   3. ghl_intake_lead: step 3 tries the link, then the campaign ID; only both missing or matching no agent is
--      'missing' / 'unknown' (the admin alert, "1 lead couldn't be matched to an agent. Pick one.").
-- Not in here (front end first, the backend prompt wires them): the launch checks' server half (agent_launch_checks:
-- link + campaign saved, test lead matched, test push answered, test call placed; a broken check pauses the campaign),
-- and the push to admins for an unmatched lead.

alter table public.lead_intake drop constraint if exists lead_intake_routing_check;
alter table public.lead_intake add constraint lead_intake_routing_check
  check (routing in ('matched', 'campaign', 'unknown', 'missing', 'inactive', 'unlicensed', 'duplicate', 'assigned'));

-- GoHighLevel → Ohvara when it creates an agent's campaign from the template: the campaign ID lands on the agent.
create or replace function public.ghl_save_campaign(p_campaign text, p_agent uuid, p_fb_campaign text default null, p_name text default null, p_lead_type text default 'appts')
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if p_campaign is null or btrim(p_campaign) = '' then raise exception 'campaign is required' using errcode = '22004'; end if;
  if p_lead_type not in ('appts', 'live') then raise exception 'bad lead type' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_agent and role = 'agent') then raise exception 'not an agent' using errcode = '22023'; end if;
  -- one campaign per agent and lead type: an older campaign for the same agent lets go of them
  update ghl_campaign_agents set agent_id = null
   where agent_id = p_agent and coalesce(lead_type, 'appts') = p_lead_type and campaign_id <> btrim(p_campaign);
  insert into ghl_campaign_agents (campaign_id, campaign_name, fb_campaign_id, agent_id, lead_type, mapped_at)
  values (btrim(p_campaign), left(p_name, 200), left(nullif(btrim(p_fb_campaign), ''), 80), p_agent, p_lead_type, now())
  on conflict (campaign_id) do update
    set agent_id = excluded.agent_id, lead_type = excluded.lead_type, mapped_at = now(),
        fb_campaign_id = coalesce(excluded.fb_campaign_id, ghl_campaign_agents.fb_campaign_id),
        campaign_name = coalesce(excluded.campaign_name, ghl_campaign_agents.campaign_name),
        last_seen_at = now();
end;
$$;
revoke execute on function public.ghl_save_campaign(text, uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.ghl_save_campaign(text, uuid, text, text, text) to service_role;

create or replace function public.ghl_intake_lead(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_key    text := nullif(btrim(p->>'intake_key'), '');
  v_kind   text := coalesce(nullif(p->>'lead_type', ''), 'booked_appointment');
  v_phone  text := public.sms_e164(p->>'phone');
  v_state  text := upper(nullif(btrim(p->>'state'), ''));
  v_first  text := left(nullif(btrim(p->>'first_name'), ''), 80);
  v_last   text := left(nullif(btrim(p->>'last_name'), ''), 80);
  v_name   text;
  v_ref    text := left(nullif(btrim(p->>'agent_id'), ''), 80);
  v_camp   text := left(nullif(btrim(p->>'campaign_id'), ''), 80);
  v_by     uuid;
  v_agent  uuid;
  v_route  text;
  v_lead   uuid;
  v_seen   record;
  v_ok     boolean;
begin
  if v_key is null or char_length(v_key) < 6 then raise exception 'intake_key is required' using errcode = '22004'; end if;
  if v_kind not in ('booked_appointment', 'live_call') then raise exception 'bad lead_type' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'bad phone' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(concat_ws(' ', v_first, v_last)), ''), 'Lead');

  perform pg_advisory_xact_lock(hashtextextended('ghl_intake:' || v_phone, 0));

  -- 1. The same delivery again (an engine retry): nothing new.
  select lead_id, routing into v_seen from lead_intake where intake_key = v_key;
  if found then
    return jsonb_build_object('lead_id', v_seen.lead_id, 'routing', v_seen.routing, 'duplicate', true);
  end if;

  -- 2. Same phone on a typed lead in the last 30 days: logged against the first lead, no second lead.
  select id into v_lead from leads
   where phone = v_phone and lead_type in ('mortgage_protection', 'policy_help')
     and created_at >= now() - interval '30 days'
   order by created_at limit 1;
  if v_lead is not null then
    insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url)
    values (v_key, v_lead, v_ref, 'duplicate', v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
            left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500));
    return jsonb_build_object('lead_id', v_lead, 'routing', 'duplicate', 'duplicate', true);
  end if;

  -- 3. Who it goes to (P913): the agent ID in the ad link, else the Meta campaign ID (one campaign per agent, saved in
  --    ghl_campaign_agents when GoHighLevel creates it). Only when both are missing or match no agent is it 'missing' /
  --    'unknown' (the admin alert "couldn't be matched to an agent").
  if v_ref is not null and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from profiles where id = v_ref::uuid and role = 'agent') then
    v_by := v_ref::uuid;
    v_route := 'matched';
  elsif v_camp is not null then
    select g.agent_id into v_by from ghl_campaign_agents g
     where (g.campaign_id = v_camp or g.fb_campaign_id = v_camp) and g.agent_id is not null
     order by (g.campaign_id = v_camp) desc limit 1;
    if v_by is not null then v_route := 'campaign'; end if;
  end if;

  if v_by is null then
    v_route := case when v_ref is null and v_camp is null then 'missing' else 'unknown' end;
  elsif not exists (select 1 from profiles where id = v_by and role = 'agent' and is_active) then
    v_route := 'inactive';
  else
    v_agent := v_by;
    -- Same test as assign_lead: one of the agent's states, and (once P881 is on) a verified licence there.
    v_ok := v_state is not null
            and exists (select 1 from agent_lead_settings s where s.agent_id = v_agent and v_state = any (s.states));
    if v_ok and to_regprocedure('public.licence_allows(uuid,text)') is not null then
      execute 'select public.licence_allows($1, $2)' into v_ok using v_agent, v_state;
    end if;
    if not coalesce(v_ok, false) then v_route := 'unlicensed'; v_agent := null; end if;
  end if;

  -- An unmatched lead pushes every admin (the alert); the notify hook is the backend prompt's (P913 front end first).
  insert into leads (lead_type, lead_source, business_name, contact_name, phone, email, state, qualifier_answers, is_sample)
  values (
    case v_kind when 'live_call' then 'policy_help' else 'mortgage_protection' end, 'meta', v_name, v_name, v_phone,
    left(nullif(btrim(p->>'email'), ''), 200), v_state,
    jsonb_strip_nulls(jsonb_build_object(
      'consent_at', p->>'consent_at', 'consent_text_version', p->>'consent_text_version',
      'postal_code', left(p->>'postal_code', 10), 'source', 'ghl'
    )) || coalesce(case when jsonb_typeof(p->'answers') = 'object' then p->'answers' end, '{}'::jsonb),
    false)
  returning id into v_lead;

  if v_agent is not null then
    update leads set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
     where id = v_lead and assigned_rep_id is null;
  end if;

  insert into lead_intake (intake_key, lead_id, agent_ref, routing, lead_kind, meta_option, campaign_id, adset_id, ad_id, contact_id, page_url)
  values (v_key, v_lead, v_ref, v_route, v_kind, nullif(p->>'meta_option', ''), left(p->>'campaign_id', 80), left(p->>'adset_id', 80),
          left(p->>'ad_id', 80), left(p->>'contact_id', 80), left(p->>'page_url', 500));

  return jsonb_build_object('lead_id', v_lead, 'routing', v_route, 'agent_id', v_agent, 'duplicate', false);
end;
$$;
revoke execute on function public.ghl_intake_lead(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_intake_lead(jsonb) to service_role;
