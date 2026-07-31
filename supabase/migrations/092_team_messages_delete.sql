-- Prompt 391: per-message delete for the Team page's Messages tab. Migration
-- 084 never added a delete policy (only select/insert existed) — sender can
-- remove their own message, admin can remove anyone's, same permission shape
-- as every other "who can delete this row" case in the app (e.g. bug_reports,
-- carriers).

create policy "team_messages_delete" on team_messages
  for delete using (
    sender_id = auth.uid() or public.is_admin()
  );

-- Realtime already publishes team_messages inserts (migration 084); add
-- deletes to the same publication so a message removed by one viewer
-- disappears live for everyone else in that conversation instead of waiting
-- on their next poll/refetch.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
  END IF;
END $$;

alter table team_messages replica identity full;
