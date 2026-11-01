-- 198 — Keep the exact words of every outgoing text, so an agent can see what
-- was said to their client. Until now the logs kept only stage or kind, status
-- and sid; older rows cannot be rebuilt, so they stay null.
--
-- NOT APPLIED. Written from a worktree; applying is a separate, checked step.
-- Additive only: two nullable columns and two comments, no backfill.
--
-- APPLY ORDER: after 122 (recovery_sms_log) and 177 (lead_followup_sms_log).
-- Apply BEFORE deploying lead-followup-sms: its 'sent' row now includes body,
-- and that insert fails while the column is missing. recovery-sms and
-- lead-workflow-sms are safe in either order.
--
-- Who writes the words (only for a text Twilio took; failed and skipped rows
-- stay null):
--   lead_followup_sms_log.body   lead-followup-sms, in the row's own insert
--   recovery_sms_log.body        recovery-sms, right after recovery_mark_sent /
--                                missed_mark_sent / sms_log_confirm wrote the
--                                row, found by policy, kind and Twilio sid
--   inbound_events.detail.body   lead-workflow-sms (jsonb, no column needed)
--
-- Both tables keep 122's and 177's revoke from anon and authenticated: this file
-- grants nothing, and agents get the words only through a function.

alter table public.lead_followup_sms_log add column if not exists body text;
alter table public.recovery_sms_log add column if not exists body text;

comment on column public.lead_followup_sms_log.body is 'exact words sent; null for rows sent before this migration';
comment on column public.recovery_sms_log.body is 'exact words sent; null for rows sent before this migration';

-- Check after applying:
--   -- Both columns are there, text and nullable, with the comment (expect 2 rows).
--   select c.table_name, c.data_type, c.is_nullable,
--          col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
--     from information_schema.columns c
--    where c.table_schema = 'public' and c.column_name = 'body'
--      and c.table_name in ('lead_followup_sms_log', 'recovery_sms_log');
--   -- anon and authenticated still get nothing (expect false in all four spots).
--   select r, has_table_privilege(r, 'public.lead_followup_sms_log', 'select'),
--             has_table_privilege(r, 'public.recovery_sms_log', 'select'),
--             has_column_privilege(r, 'public.lead_followup_sms_log', 'body', 'select'),
--             has_column_privilege(r, 'public.recovery_sms_log', 'body', 'select')
--     from unnest(array['anon', 'authenticated']) r;
--   -- The recovery-sms worker can add the words (expect true).
--   select has_table_privilege('service_role', 'public.recovery_sms_log', 'update');
--   -- Nothing was backfilled (expect 0 and 0 right after applying).
--   select (select count(*) from public.lead_followup_sms_log where body is not null),
--          (select count(*) from public.recovery_sms_log where body is not null);
--   -- The texting switch is untouched (expect false).
--   select sms_live from public.recovery_config;
