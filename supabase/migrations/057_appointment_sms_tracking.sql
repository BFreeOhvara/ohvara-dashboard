-- Track which SMS reminders have fired per appointment.
-- Prevents duplicate sends across cron ticks.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS sms_24h_sent   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_1h_sent    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_10min_sent boolean DEFAULT false;
