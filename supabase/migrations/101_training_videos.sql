-- Prompt 417: Training Center Videos tab. Real YouTube-embed videos,
-- admin-managed, everyone-readable -- same shape as `carriers` (migration
-- 072): one flat directory table, `public.is_admin()` gates writes, plain
-- authenticated-select for read. sort_order drives display order; admin
-- reorders via swap-two-rows updates from the client, no separate RPC needed
-- for a handful of rows.
create table training_videos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  youtube_url text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id) on delete set null
);

alter table training_videos enable row level security;

create policy "training_videos_select" on training_videos
  for select using (auth.uid() is not null);
create policy "training_videos_admin_write" on training_videos
  for all using (public.is_admin()) with check (public.is_admin());

comment on column training_videos.youtube_url is
  'Raw pasted YouTube URL (watch/youtu.be/embed/shorts, any form) -- the video ID is parsed client-side for the thumbnail and embed src, same URL is kept verbatim for reference.';
