-- 163 — Log for the instant lead follow-up text (lead-followup-sms).
--
-- NOT APPLIED. Written from a worktree; applying is a separate, checked step.
-- Additive: one new table. Needs `leads` with lead_type (migration 161, lead
-- types). One row per attempt, including attempts that sent nothing
-- ('skipped_gate' while recovery_config.sms_live is off). Service role only.

create table if not exists public.lead_followup_sms_log (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  status     text not null check (status in (
    'sent', 'failed', 'skipped_gate', 'skipped_opt_out', 'skipped_no_phone',
    'skipped_no_agent', 'skipped_no_link', 'skipped_not_mp'
  )),
  to_phone   text,
  twilio_sid text,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists lead_followup_sms_log_lead_idx on public.lead_followup_sms_log (lead_id, created_at desc);
-- A lead is texted once, even if the trigger fires twice at the same moment.
create unique index if not exists lead_followup_sms_log_one_sent_idx on public.lead_followup_sms_log (lead_id) where status = 'sent';

alter table public.lead_followup_sms_log enable row level security;
revoke all on public.lead_followup_sms_log from anon, authenticated;
