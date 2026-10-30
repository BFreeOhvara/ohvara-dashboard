-- 186 — is_sample flag on the agent-side tables, so sample data on the agent
-- pages can be wiped with one script (Agent Side Finish, Sample data).
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's call at the
-- door. Additive only: one boolean column and one partial index per table.
-- Existing rows read false. Nothing is dropped, renamed, truncated or deleted,
-- and no policy, grant or trigger changes. Safe to run twice.
--
-- APPLY ORDER: any time. A listed table that doesn't exist yet (177, 179, 180
-- and 183 were also written as NOT APPLIED) is skipped with a notice. Run this
-- file again after that table lands.
--
-- Sample rows are written and removed by scripts/seed_agent_sample.py and
-- scripts/wipe_agent_sample.py, which generate one SQL transaction each.
--
-- policy_events (118) is protected by 153's log_append_only: direct deletes and
-- most updates raise. The rows the booking trigger writes for a sample policy
-- are backdated and marked by the seed in the same transaction, which the guard
-- allows (updates pass while old.at = now()).
--
-- The seed skips a table that doesn't have the column, so any new table that
-- should hold sample rows needs adding to the list below.
--
-- The flag is for scripts only and this file grants nothing on it. That does
-- not by itself keep it out of the API: no migration narrows the default
-- table-level grants on leads, policies, policy_fulfillment_details or
-- policy_messages, and a table-level INSERT or UPDATE covers new columns, so
-- whoever RLS lets write a row can set the flag on it (an agent on a booking
-- they make, say). The wipe therefore must not trust is_sample alone; it also
-- has to limit every delete to the test agent's rows. The check below shows
-- where the column is writable.

do $$
declare
  t text;
begin
  foreach t in array array[
    'policies',
    'policy_fulfillment_details',
    'policy_events',
    'policy_messages',
    'leads',
    'lead_sms_replies',
    'lead_followup_sms_log',
    'inbound_events',
    'servicing_tasks',
    'help_calls'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists is_sample boolean not null default false', t);
      execute format('create index if not exists %I on public.%I (is_sample) where is_sample', t || '_is_sample_idx', t);
    else
      raise notice '186: public.% does not exist yet, skipped', t;
    end if;
  end loop;
end $$;

-- Check after applying (one row per table that got the column; true in the last
-- two means the API can write the flag where RLS lets it write the row):
--   select c.table_name, c.column_default, c.is_nullable,
--          has_column_privilege('authenticated', format('public.%I', c.table_name), 'is_sample', 'insert') as insert_allowed,
--          has_column_privilege('authenticated', format('public.%I', c.table_name), 'is_sample', 'update') as update_allowed
--     from information_schema.columns c
--    where c.table_schema = 'public' and c.column_name = 'is_sample'
--    order by 1;
