-- Prompt 759 — Admin Pipeline is view only, enforced here.
--
-- Admin reads every client (policies_select → can_view_agent, unchanged) but
-- can no longer change a client's status, booking or details unless they are
-- that client's agent (agent_id) or assigned Fulfillment rep. Admin powers that
-- aren't client status stay: users, settings, payouts, and reassigning a call
-- (fulfillment_pass_on, fulfillment_assign_unassigned — P760's "Give to").
--
-- The checks also move from `not (a = b)` to `a is distinct from b`, so a row
-- with no assigned rep (null) is refused instead of slipping through.

-- 1. Direct writes under RLS. Fulfillment keeps fulfillment_update_assigned.
alter policy policies_update on public.policies using (agent_id = auth.uid());
alter policy policies_delete on public.policies using (agent_id = auth.uid());
alter policy policies_insert on public.policies with check (agent_id = auth.uid());

alter policy fulfillment_details_insert on public.policy_fulfillment_details
  with check (exists (select 1 from public.policies p
                      where p.id = policy_fulfillment_details.policy_id and p.agent_id = auth.uid()));
alter policy fulfillment_details_update on public.policy_fulfillment_details
  using (exists (select 1 from public.policies p
                 where p.id = policy_fulfillment_details.policy_id
                   and (p.agent_id = auth.uid() or p.assigned_fulfillment_id = auth.uid())));

-- 2. The status/booking RPCs: drop the admin bypass from each caller check.
-- Rewrites the live definitions in place and fails loudly if a check isn't
-- where it's expected (so a drifted function can't be skipped silently).
do $$
declare
  fixes constant text[][] := array[
    ['agent_rebook_call',
     'if not (public.is_admin() or pol.agent_id = auth.uid()) then',
     'if pol.agent_id is distinct from auth.uid() then'],
    ['agent_confirm_recovery_number',
     'if not (public.is_admin() or pol.agent_id = auth.uid()) then',
     'if pol.agent_id is distinct from auth.uid() then'],
    ['agent_change_booking',
     'if not (public.is_admin() or pol.agent_id = v_actor) then',
     'if pol.agent_id is distinct from v_actor then'],
    ['agent_set_booking_carrier',
     'if v_agent <> auth.uid() and not public.is_admin() then',
     'if v_agent is distinct from auth.uid() then'],
    ['fulfillment_start_call',
     'if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then',
     'if pol.assigned_fulfillment_id is distinct from auth.uid() then'],
    ['fulfillment_end_call',
     'if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then',
     'if pol.assigned_fulfillment_id is distinct from auth.uid() then'],
    ['fulfillment_correct_result',
     'if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then',
     'if pol.assigned_fulfillment_id is distinct from auth.uid() then'],
    ['fulfillment_set_reschedule_reason',
     'if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then',
     'if pol.assigned_fulfillment_id is distinct from auth.uid() then']
  ];
  i int;
  def text;
  fixed text;
begin
  for i in 1 .. array_length(fixes, 1) loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fixes[i][1];
    if def is null then
      raise exception 'P759: function % not found', fixes[i][1];
    end if;
    fixed := replace(def, fixes[i][2], fixes[i][3]);
    if fixed = def then
      raise exception 'P759: caller check not found in %', fixes[i][1];
    end if;
    fixed := replace(fixed, ' (or an admin)', '');
    execute fixed;
  end loop;
end $$;
