-- Prompt 400: correction to migration 092's "team_messages_delete" policy.
-- Real usage has started and Brayden's explicit call is that there is no
-- admin override on message delete — only the sender of a message can
-- remove it, full stop, not even the admin account.

drop policy if exists "team_messages_delete" on team_messages;

create policy "team_messages_delete" on team_messages
  for delete using (
    sender_id = auth.uid()
  );
