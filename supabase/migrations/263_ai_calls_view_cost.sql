-- P926 — admin Leads › AI calls shows each call's minutes and cost, and marks admin test calls (sample leads, made by
-- ai-caller test_call). Same function as 244 with four more fields on each row and a test count; nothing else changes.
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
                       'summary', c.summary, 'booked_for', c.booked_for, 'callback_at', c.callback_at) order by c.created_at desc)
                       from (select * from c order by created_at desc limit 200) c
                       left join public.leads l on l.id = c.lead_id left join public.profiles p on p.id = c.agent_id), '[]'::jsonb),
    'to_va', (select count(*) from public.ai_calls where created_at >= f and created_at < t and status = 'to_va')
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_ai_calls_view(date, date) from public, anon;
grant execute on function public.admin_ai_calls_view(date, date) to authenticated, service_role;
