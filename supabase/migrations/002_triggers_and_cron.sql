-- ============================================================
-- DB Trigger: when a lead is set to Booked, call assign-closer
-- ============================================================

-- Requires pg_net extension (enabled by default on Supabase)
create extension if not exists pg_net;

-- Function called by trigger — posts to the assign-closer Edge Function
create or replace function notify_assign_closer()
returns trigger language plpgsql security definer as $$
begin
  -- Only fire when status changes TO 'Booked'
  if new.status = 'Booked' and (old.status is null or old.status <> 'Booked') then
    perform net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/assign-closer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := jsonb_build_object(
        'lead_id', new.id,
        'rep_id', new.assigned_rep_id
      )
    );
  end if;
  return new;
end;
$$;

create trigger lead_booked_assign_closer
  after update on leads
  for each row execute procedure notify_assign_closer();

-- ============================================================
-- pg_cron: nightly jobs (midnight CST = 06:00 UTC)
-- ============================================================
create extension if not exists pg_cron;

-- Daily batch assignment
select cron.schedule(
  'assign-daily-batch',
  '0 6 * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/assign-daily-batch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);

-- Re-engagement trigger
select cron.schedule(
  'trigger-re-engagement',
  '15 6 * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/trigger-re-engagement',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);

-- ============================================================
-- App settings (set these in Supabase Dashboard → Settings → Vault)
-- or run: alter database postgres set app.supabase_url = '<url>';
--          alter database postgres set app.service_role_key = '<key>';
-- ============================================================
