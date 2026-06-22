-- Migration 047: Notify rep when their booked appointment is closed by the closer
--
-- Prompt 43, Change 2 ("Appointment closed by Nate"). Recon found the other
-- three rep notification triggers Prompt 43 asked for already exist (Prompt
-- 32): badge unlocks (useBadgeNotifier), follow-up reminders
-- (useFollowUpNotifier), and message replies (migration 043's
-- notify_rep_on_message_reply trigger — "new message received" for a rep is
-- always a reply, since reps only ever message Brayden/Nate, there's no
-- separate inbound-message path). This migration adds the one genuinely
-- missing trigger.
--
-- The closer-side update (AppointmentCard.jsx's handleComplete) sets
-- status='completed' + outcome='closed'/'lost'/'no_show' via a generic
-- useUpdateAppointment mutation. A client-side insert into `notifications`
-- for the REP's profile_id from Nate's session would be blocked by the
-- existing RLS ("Reps insert own notifications": profile_id = auth.uid()),
-- since Nate isn't the rep — so this has to be a SECURITY DEFINER trigger,
-- same pattern as migration 043's message-reply notifier.
--
-- DO NOT run supabase db push for this migration — apply via SQL editor,
-- same as 040-046.

CREATE OR REPLACE FUNCTION notify_rep_on_deal_closed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_business_name text;
BEGIN
  IF NEW.rep_id IS NOT NULL
     AND NEW.status = 'completed' AND NEW.outcome = 'closed'
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.outcome IS DISTINCT FROM NEW.outcome) THEN
    SELECT business_name INTO v_business_name FROM leads WHERE id = NEW.lead_id;

    INSERT INTO notifications (profile_id, type, message, data)
    VALUES (
      NEW.rep_id,
      'deal_closed',
      'Deal closed: ' || COALESCE(v_business_name, 'a lead you booked'),
      jsonb_build_object(
        'appointment_id', NEW.id,
        'lead_id', NEW.lead_id,
        'business_name', v_business_name,
        'deal_value', NEW.deal_value
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'appointments_closed_notify'
  ) THEN
    CREATE TRIGGER appointments_closed_notify
      AFTER UPDATE ON appointments
      FOR EACH ROW EXECUTE FUNCTION notify_rep_on_deal_closed();
  END IF;
END $$;
