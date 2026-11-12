-- P976 — the AI caller's voice split (Brayden, Nov 12): two Retell agents on one LLM, ElevenLabs Hope and Mark,
-- alternated on outgoing calls so booked-call rates can be compared per voice. Adds the voice used to each call, the
-- two agents to the settings (written by ai-caller retell_split), the per-voice first-call counts the alternation
-- reads, and per-voice totals in admin AI calls (same function as 263 plus 'voice' on each row and 'by_voice').
-- ai_caller_live is not read or changed.

alter table public.ai_calls add column if not exists voice text
  check (voice is null or (char_length(voice) <= 20 and voice ~ '^[a-z]+$'));
comment on column public.ai_calls.voice is 'P976: the caller voice this call used (retellSpec.js CALLER_VOICES key: hope | mark); null = the single old agent.';
create index if not exists ai_calls_voice_idx on public.ai_calls (voice) where voice is not null;

alter table public.ai_caller_settings add column if not exists voice_agents jsonb
  check (voice_agents is null or jsonb_typeof(voice_agents) = 'object');
comment on column public.ai_caller_settings.voice_agents is 'P976: {voice: {voice_id, agent_id}} on Retell, written by ai-caller retell_split. Null = no split; the old agent calls.';

-- First calls per voice so far (tests and real leads apart). Only ai-caller (service role) calls it.
create or replace function public.ai_caller_voice_counts(p_tests boolean)
returns table (voice text, n bigint) language sql stable security definer set search_path = public as $$
  select c.voice, count(*) from public.ai_calls c join public.leads l on l.id = c.lead_id
  where c.voice is not null and c.attempt = 1 and coalesce(l.is_sample, false) = coalesce(p_tests, false)
  group by c.voice;
$$;
revoke all on function public.ai_caller_voice_counts(boolean) from public, anon, authenticated;
grant execute on function public.ai_caller_voice_counts(boolean) to service_role;

create or replace function public.admin_ai_calls_view(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz; res jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  f := (coalesce(p_from, (now() at time zone 'America/Chicago')::date - 6))::timestamp at time zone 'America/Chicago';
  t := (coalesce(p_to, (now() at time zone 'America/Chicago')::date) + 1)::timestamp at time zone 'America/Chicago';
  with c as (select * from public.ai_calls where created_at >= f and created_at < t and status in ('done', 'handing_off'))
  select jsonb_build_object(
    'calls', (select count(*) from c),
    'leads', (select count(*) from c where attempt = 1),
    'reached', (select count(distinct lead_id) from c where outcome is distinct from 'no_answer' and outcome is not null),
    'booked', (select count(*) from c where outcome = 'booked'),
    'transferred', (select count(*) from c where outcome = 'transferred'),
    'handed', (select count(*) from c where outcome = 'handed_to_va'),
    'no_answer', (select count(*) from c where outcome = 'no_answer'),
    'opt_out', (select count(*) from c where outcome = 'opt_out'),
    'not_now', (select count(*) from c where outcome = 'not_now'),
    'wrong_number', (select count(*) from c where outcome = 'wrong_number'),
    'tests', (select count(*) from c join public.leads l on l.id = c.lead_id where l.is_sample),
    'avg_secs', (select round(avg(secs_to_dial)::numeric, 1) from c where attempt = 1),
    'minutes', (select round(coalesce(sum(duration_secs), 0) / 60.0, 1) from c),
    'cost_cents', (select sum(cost_cents) from c),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'lead_id', c.lead_id, 'name', l.contact_name, 'state', l.state,
                       'agent', p.full_name, 'at', c.created_at, 'attempt', c.attempt, 'secs', round(c.secs_to_dial),
                       'duration', c.duration_secs, 'outcome', c.outcome, 'handoff_reason', c.handoff_reason, 'routed', c.routed,
                       'callback_task', c.callback_task, 'cost_cents', c.cost_cents, 'test', coalesce(l.is_sample, false),
                       'summary', c.summary, 'booked_for', c.booked_for, 'callback_at', c.callback_at, 'voice', c.voice) order by c.created_at desc)
                       from (select * from c order by created_at desc limit 200) c
                       left join public.leads l on l.id = c.lead_id left join public.profiles p on p.id = c.agent_id), '[]'::jsonb),
    -- P976: the voice split, real leads only (admin test calls left out): calls, answered, booked, transfers, minutes, cost.
    'by_voice', coalesce((select jsonb_agg(jsonb_build_object('voice', v.voice, 'calls', v.calls, 'answered', v.answered, 'booked', v.booked,
                       'transferred', v.transferred, 'minutes', v.minutes, 'cost_cents', v.cost_cents) order by v.voice)
                       from (select c.voice, count(*) calls,
                               count(*) filter (where c.outcome is not null and c.outcome <> 'no_answer') answered,
                               count(*) filter (where c.outcome = 'booked') booked,
                               count(*) filter (where c.outcome = 'transferred') transferred,
                               round(coalesce(sum(c.duration_secs), 0) / 60.0, 1) minutes, sum(c.cost_cents) cost_cents
                             from c join public.leads l on l.id = c.lead_id
                             where c.voice is not null and not coalesce(l.is_sample, false) group by c.voice) v), '[]'::jsonb),
    'to_va', (select count(*) from public.ai_calls where created_at >= f and created_at < t and status = 'to_va')
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_ai_calls_view(date, date) from public, anon;
grant execute on function public.admin_ai_calls_view(date, date) to authenticated, service_role;
