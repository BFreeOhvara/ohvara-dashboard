-- Schedule send-appointment-reminders every 5 minutes via pg_cron + pg_net.
-- Requires both extensions to be enabled in Supabase (Database > Extensions).
-- If unavailable, set up an external cron to POST to the edge function instead.
SELECT cron.schedule(
  'send-appointment-reminders',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  )$$
);
