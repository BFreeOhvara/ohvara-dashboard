-- ============================================================
-- Migration 004: Appointment reminder log + cron processor
-- ============================================================

create type reminder_status as enum ('pending', 'sent', 'cancelled', 'failed');

create table reminder_log (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null references appointments(id) on delete cascade,
  scheduled_time   timestamptz not null,  -- when this reminder should fire
  send_time        timestamptz,           -- when it actually fired
  status           reminder_status not null default 'pending',
  channel          text not null default 'sms',
  message_body     text,
  twilio_message_sid text,
  error_message    text,
  created_at       timestamptz not null default now()
);

alter table reminder_log enable row level security;

-- Admins see all; closers see their own appointments' reminders
create policy "reminder_log_select" on reminder_log
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
    or exists (
      select 1 from appointments a
      where a.id = reminder_log.appointment_id
        and a.closer_id = auth.uid()
    )
  );

create index reminder_log_appointment_id_idx on reminder_log(appointment_id);
create index reminder_log_status_scheduled_idx on reminder_log(status, scheduled_time)
  where status = 'pending';

-- ============================================================
-- pg_cron: process-reminders runs every minute
-- ============================================================
-- Requires pg_cron and pg_net extensions (already enabled in migration 002)

select cron.schedule(
  'process-reminders',
  '* * * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/process-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);
