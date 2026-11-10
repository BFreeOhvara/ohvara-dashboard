-- P929 follow-up (applied on live right after 260_test_accounts): 260's move of the test agent's policies to the demo
-- side was undone by policies_demo_stamp, which keeps is_demo fixed on every update. Switch that one trigger off for
-- this single update, then back on.
alter table public.policies disable trigger a1_policies_demo;
update public.policies po set is_demo = true
 where not po.is_demo and po.agent_id in (select id from public.profiles where is_test);
alter table public.policies enable trigger a1_policies_demo;
-- A real VA left on one comes off it (what policies_demo_guard does on any later update).
update public.policies po set assigned_fulfillment_id = null, fulfillment_claimed_at = null
 where po.is_demo and po.assigned_fulfillment_id is not null
   and not coalesce((select is_demo from public.profiles where id = po.assigned_fulfillment_id), false);
