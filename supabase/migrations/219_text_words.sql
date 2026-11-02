-- 219 — Keep the exact words of every outgoing text, so an agent can see what
-- was said to their client. Until now the logs kept only stage or kind, status
-- and sid; older rows cannot be rebuilt, so they stay null.
--
-- NOT APPLIED. Written from a worktree; applying is a separate, checked step.
-- Additive only: 177's two tables and their indexes, two nullable columns and
-- two comments, no backfill.
--
-- APPLY ORDER: after 122 (recovery_sms_log). 177 was not on Ohvara as of Nov 2,
-- so this file also creates its two tables (lead_followup_sms_log and
-- agent_sms_senders), both empty and service-role only, and approving this door
-- item covers both. It is safe whether or not 177 was applied first, and applying
-- 177 afterwards changes nothing.
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

-- 177's statements, word for word.
create table if not exists public.lead_followup_sms_log (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  stage       text check (stage in ('just_submitted', 'not_reached', 'reached', 'opted_out')),
  status      text not null check (status in (
    'sent', 'failed', 'skipped_gate', 'skipped_opt_out', 'skipped_no_phone',
    'skipped_no_agent', 'skipped_no_sender', 'skipped_no_link', 'skipped_not_mp',
    'skipped_quiet_hours', 'skipped_cap', 'skipped_no_stage'
  )),
  to_phone    text,
  from_number text,
  twilio_sid  text,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists lead_followup_sms_log_lead_idx on public.lead_followup_sms_log (lead_id, created_at desc);
-- Each stage is texted once per lead, even if two calls land at the same moment.
create unique index if not exists lead_followup_sms_log_one_sent_idx
  on public.lead_followup_sms_log (lead_id, stage) where status = 'sent';

alter table public.lead_followup_sms_log enable row level security;
revoke all on public.lead_followup_sms_log from anon, authenticated;

create table if not exists public.agent_sms_senders (
  agent_id              uuid primary key references public.profiles(id) on delete cascade,
  from_number           text not null check (from_number ~ '^\+[1-9][0-9]{7,14}$'),
  messaging_service_sid text,
  brand_name            text,
  active                boolean not null default true
);

alter table public.agent_sms_senders enable row level security;
revoke all on public.agent_sms_senders from anon, authenticated;

-- The words.
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
--   -- 177's other table is closed the same way (expect false, false).
--   select has_table_privilege('anon', 'public.agent_sms_senders', 'select'),
--          has_table_privilege('authenticated', 'public.agent_sms_senders', 'select');
--   -- The recovery-sms worker can add the words (expect true).
--   select has_table_privilege('service_role', 'public.recovery_sms_log', 'update');
--   -- Nothing was backfilled (expect 0 and 0 right after applying).
--   select (select count(body) from public.lead_followup_sms_log),
--          (select count(body) from public.recovery_sms_log);
--   -- The texting switch is untouched (expect false).
--   select sms_live from public.recovery_config;
