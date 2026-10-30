-- NNN — The agent's own incoming live transfer, for the in-portal ring (Agent
-- Portal Rework step 4: "Live-transfer alert: rings in the portal ... while the
-- agent is active"). Phone push waits for Firebase/FCM.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Runs after 174 (agent_duty) and 179 (help_calls). Additive only: one new
-- read function. No table, policy or grant that exists is changed.
--
--   function public.my_incoming_transfer()
--     -> (help_call_id uuid, transfer_started_at timestamptz, lead_id uuid,
--         caller_label text)
--
-- help-transfer dials the agent's phone into the conference and sets
-- help_calls.status 'transferring' and transfer_agent_id. Agents can't read
-- help_calls (179: VA / admin select only), so the portal (components/agent/
-- TransferAlert) asks this function every 4s while the agent is Active.
--
-- Security definer so it can read help_calls past RLS, which is why it returns
-- only the caller's own row: transfer_agent_id = auth.uid(), status
-- 'transferring', started in the last 2 minutes, and only while the caller's
-- agent_duty.on_duty is true and they are an active agent. Anyone else gets zero
-- rows. caller_label is the lead's first name, else 'New caller'; it never
-- carries the phone number (a name that holds digits reads 'New caller' too).

create or replace function public.my_incoming_transfer()
 returns table (help_call_id uuid, transfer_started_at timestamptz, lead_id uuid, caller_label text)
 language sql
 stable security definer
 set search_path = public
as $$
  select h.id,
         h.transfer_started_at,
         h.lead_id,
         case
           when nullif(split_part(btrim(l.contact_name), ' ', 1), '') is null then 'New caller'
           when split_part(btrim(l.contact_name), ' ', 1) ~ '[0-9]' then 'New caller'
           else split_part(btrim(l.contact_name), ' ', 1)
         end
    from public.help_calls h
    join public.agent_duty d on d.agent_id = h.transfer_agent_id
    join public.profiles p on p.id = h.transfer_agent_id
    left join public.leads l on l.id = h.lead_id
   where auth.uid() is not null
     and h.transfer_agent_id = auth.uid()
     and h.status = 'transferring'
     and h.transfer_started_at > now() - interval '2 minutes'
     and d.on_duty
     and p.role = 'agent'
     and p.is_active
   order by h.transfer_started_at desc
   limit 1;
$$;

revoke execute on function public.my_incoming_transfer() from public, anon;
grant execute on function public.my_incoming_transfer() to authenticated;

-- Check after applying (expect anon false, authenticated true; zero rows for a
-- caller who isn't the transfer agent, isn't on duty, or after 2 minutes):
--   select has_function_privilege('anon', 'public.my_incoming_transfer()', 'execute') anon,
--          has_function_privilege('authenticated', 'public.my_incoming_transfer()', 'execute') authed;
