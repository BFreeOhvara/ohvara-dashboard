-- 177 — Log for the lead follow-up texts (lead-followup-sms), and each agent's
-- own texting number.
--
-- NOT APPLIED. Written from a worktree; applying is a separate, checked step.
-- APPLY ORDER: after 166_lead_types_delivery (leads.lead_type), which the
-- function reads. Additive: two new tables, no trigger, no cron.
--
-- lead_followup_sms_log is ported from 168_lead_followup_sms_log.sql (branch
-- atlas/ea81c4e0-instant-text-follow-up-gated-on-, never merged), now with a
-- stage per row (just_submitted, not_reached, reached, opted_out), the sending
-- number, and the extra skip reasons. One row per attempt, including attempts
-- that sent nothing ('skipped_gate' while recovery_config.sms_live is off).
-- At most one 'sent' row per (lead, stage). Service role only.
--
-- agent_sms_senders holds the number (and optional Messaging Service) each
-- agent texts leads from. It stays empty until per-agent texting setup exists;
-- with no active row the function sends nothing (skipped_no_sender).
-- Service role only.

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
