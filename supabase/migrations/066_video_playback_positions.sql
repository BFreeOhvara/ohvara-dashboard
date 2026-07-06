-- Prompt 232 item E: per-video playback position so a rep can exit a
-- training video mid-watch and resume from where they left off, instead of
-- being locked in with no way out.
alter table training_progress
  add column if not exists video_positions jsonb not null default '{}'::jsonb;
