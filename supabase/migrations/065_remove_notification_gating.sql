-- ============================================================
-- Migration 065 — remove notification_prefs gating (Prompt 227)
--
-- Brayden doesn't want reps/closers able to turn off any notifications.
-- Migration 064 added a per-category opt-out toggle (Settings >
-- Notifications) and gated notify_rep_on_message_reply() (043) on it —
-- this reverts that one server-side gate back to always firing, matching
-- 043's original unconditional version. Every client-side gate
-- (isNotificationCategoryEnabled checks in useRepNotificationTriggers.js /
-- useCloserNotificationTriggers.js / grade-call) was removed in the same
-- prompt, frontend-only, no migration needed for those.
--
-- notification_prefs / working_hours_* columns are left in place
-- (unused, harmless) rather than dropped — no other prompt asked for a
-- column removal and working_hours_* still backs the Settings > Calling
-- section, which stays.
-- ============================================================

create or replace function notify_rep_on_message_reply()
returns trigger language plpgsql security definer as $$
begin
  if new.reply_body is not null and old.reply_body is null then
    insert into notifications (profile_id, type, message, data)
    values (
      new.sender_id,
      'message',
      'You received a reply to your message',
      jsonb_build_object(
        'message_id', new.id,
        'reply_preview', left(new.reply_body, 120)
      )
    );
  end if;
  return new;
end;
$$;
