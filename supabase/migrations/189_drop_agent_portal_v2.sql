-- Retire the agent portal v2 flag. Brayden, Oct 29: no v2 flag; it stays off and
-- gets retired at the end.
--
-- NOT APPLIED. Destructive: drops a column, written from a worktree. Applied only
-- through Brayden's door; his "Merge it" merges this file and applies it to the
-- live database right away.
--
--   app_settings.agent_portal_v2   added by 180_agent_inbounds.sql, off by default.
--                                  The code that read it left master in c957434.
--                                  useAppSettings reads select('*'), so an older
--                                  bundle sees the flag as off once the column
--                                  is gone.

alter table public.app_settings drop column if exists agent_portal_v2;
